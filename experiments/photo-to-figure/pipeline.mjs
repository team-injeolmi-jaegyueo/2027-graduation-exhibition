// 체험자 사진 → GPT 토이 이미지 → Tripo 3D 모델(.glb)
// 실행 방법은 README.md 참고. 의존성 없이 Node 22 내장 fetch만 씁니다.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export function mimeOf(file) {
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`지원하지 않는 이미지 형식입니다 (png·jpg·webp만 가능): ${file}`);
  return type;
}

export function config(env = process.env) {
  return {
    openaiKey: env.OPENAI_API_KEY || '',
    openaiBase: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    imageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-sunburst',
    imageQuality: env.OPENAI_IMAGE_QUALITY || 'high',
    imageSize: env.OPENAI_IMAGE_SIZE || '1024x1536', // 세로 2:3
    tripoKey: env.TRIPO_API_KEY || '',
    tripoBase: env.TRIPO_BASE_URL || 'https://openapi.tripo3d.ai/v3',
    tripoModel: env.TRIPO_MODEL || 'v3.1-20260211',
    tripoTextureQuality: env.TRIPO_TEXTURE_QUALITY || 'standard',
    tripoTimeoutMs: Number(env.TRIPO_TIMEOUT_SEC || 300) * 1000,
    pollMs: Number(env.TRIPO_POLL_MS || 2000), // 문서 권장: 2초마다, 초당 1회 이하
  };
}

async function failText(res) {
  const body = await res.text().catch(() => '');
  return `HTTP ${res.status} ${body.slice(0, 500)}`;
}

export async function loadPrompt() {
  return (await readFile(new URL('./prompt.txt', import.meta.url), 'utf8')).trim();
}

export async function imageFile(file) {
  return { buf: await readFile(file), type: mimeOf(file), ext: path.extname(file).toLowerCase() };
}

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

// 'data:image/jpeg;base64,...' → { buf, type, ext }
export function fromDataUrl(url) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  if (!m) throw new Error('사진은 png·jpeg·webp data URL이어야 합니다.');
  return { buf: Buffer.from(m[2], 'base64'), type: m[1], ext: EXT[m[1]] };
}

// ---------- 1단계: GPT 이미지 편집 (Image 1 = 마스터, Image 2 = 체험자) ----------
// master, person: { buf, type, ext }
export async function generateFigureImage({ master, person, prompt, cfg }) {
  const form = new FormData();
  form.append('model', cfg.imageModel);
  form.append('prompt', prompt);
  form.append('size', cfg.imageSize);
  form.append('quality', cfg.imageQuality);
  form.append('output_format', 'png');
  form.append('n', '1');
  // 순서가 곧 프롬프트의 Image 1, Image 2입니다.
  for (const [img, name] of [[master, 'image1-master'], [person, 'image2-person']]) {
    form.append('image[]', new Blob([img.buf], { type: img.type }), name + img.ext);
  }

  const res = await fetch(`${cfg.openaiBase}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.openaiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`이미지 생성 실패: ${await failText(res)}`);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('이미지 생성 응답에 b64_json이 없습니다.');
  return { png: Buffer.from(b64, 'base64'), usage: json.usage ?? null, revisedPrompt: json.data[0].revised_prompt ?? null };
}

// ---------- 2단계: Tripo 이미지 → 3D ----------
async function tripo(cfg, pathname, init = {}) {
  const res = await fetch(`${cfg.tripoBase}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.tripoKey}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Tripo ${pathname} 실패: ${await failText(res)}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`Tripo ${pathname} 오류: ${json.message ?? ''} ${json.suggestion ?? ''} (code ${json.code})`);
  return json.data;
}

export async function uploadToTripo(png, cfg) {
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'figure.png');
  const data = await tripo(cfg, '/files', { method: 'POST', body: form });
  return data.file_token;
}

export async function createModelTask(fileToken, cfg) {
  const body = {
    input: fileToken,
    model: cfg.tripoModel,
    texture: true,
    pbr: true,
    texture_quality: cfg.tripoTextureQuality,
  };
  const data = await tripo(cfg, '/generation/image-to-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return data.task_id;
}

const TERMINAL = new Set(['success', 'failed', 'cancelled', 'banned', 'expired']);

export async function waitForTask(taskId, cfg, onProgress = () => {}) {
  const deadline = Date.now() + cfg.tripoTimeoutMs;
  while (true) {
    const task = await tripo(cfg, `/tasks/${encodeURIComponent(taskId)}`);
    onProgress(task);
    if (TERMINAL.has(task.status)) {
      if (task.status !== 'success') {
        throw new Error(`Tripo 작업 ${task.status}: ${task.error_code ?? ''} ${task.error_message ?? ''}`.trim());
      }
      return task;
    }
    if (Date.now() > deadline) throw new Error(`Tripo 작업이 ${cfg.tripoTimeoutMs / 1000}초 안에 끝나지 않았습니다 (마지막 상태: ${task.status}).`);
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`내려받기 실패 ${url}: ${await failText(res)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- 전체 흐름 ----------
export async function run({ photoPath, masterPath, outDir, imagePath = null, skip3d = false, cfg, log = console.log }) {
  await mkdir(outDir, { recursive: true });
  const report = { photo: path.basename(photoPath ?? ''), master: path.basename(masterPath ?? ''), imageModel: cfg.imageModel, tripoModel: cfg.tripoModel, steps: {} };
  const t0 = Date.now();

  let png;
  if (imagePath) {
    png = await readFile(imagePath);
    log(`이미지 생성 건너뜀: ${imagePath} 사용`);
  } else {
    log(`1/2 이미지 생성 중 (${cfg.imageModel}, ${cfg.imageQuality}) …`);
    const s = Date.now();
    const out = await generateFigureImage({ master: await imageFile(masterPath), person: await imageFile(photoPath), prompt: await loadPrompt(), cfg });
    png = out.png;
    report.steps.image = { seconds: (Date.now() - s) / 1000, usage: out.usage };
    if (out.revisedPrompt) report.steps.image.revisedPrompt = out.revisedPrompt;
    await writeFile(path.join(outDir, 'figure.png'), png);
    log(`   완료 ${report.steps.image.seconds.toFixed(1)}초 → figure.png`);
  }

  if (!skip3d) {
    log(`2/2 Tripo 3D 변환 중 (${cfg.tripoModel}) …`);
    const s = Date.now();
    const token = await uploadToTripo(png, cfg);
    const taskId = await createModelTask(token, cfg);
    log(`   작업 ${taskId}`);
    let last = -1;
    const task = await waitForTask(taskId, cfg, (t) => {
      if (t.progress !== last) { last = t.progress; log(`   ${t.status} ${t.progress ?? 0}%`); }
    });
    // 모델 URL은 5분 뒤 만료되므로 바로 내려받습니다.
    const glb = await download(task.output.model_url);
    await writeFile(path.join(outDir, 'model.glb'), glb);
    if (task.output.rendered_image_url) {
      await writeFile(path.join(outDir, 'tripo-preview.png'), await download(task.output.rendered_image_url)).catch(() => {});
    }
    report.steps.model = { seconds: (Date.now() - s) / 1000, taskId, credits: task.credits_consumed ?? null, bytes: glb.length };
    log(`   완료 ${report.steps.model.seconds.toFixed(1)}초, ${task.credits_consumed ?? '?'} 크레딧 → model.glb`);
  }

  report.totalSeconds = (Date.now() - t0) / 1000;
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  log(`전체 ${report.totalSeconds.toFixed(1)}초. 결과: ${outDir}`);
  return report;
}
