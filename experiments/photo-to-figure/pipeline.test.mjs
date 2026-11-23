// 가짜 OpenAI·Tripo 서버로 요청 형식과 흐름을 확인합니다. 실제 API·크레딧을 쓰지 않습니다.
// 실행: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config, run, mimeOf } from './pipeline.mjs';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG 시그니처만 있는 가짜 이미지

function mockServer({ taskStates = ['queued', 'running', 'success'], openaiStatus = 200 } = {}) {
  const seen = { edits: null, upload: null, task: null, polls: 0 };
  let i = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const send = (code, obj, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type });
      res.end(type === 'application/json' ? JSON.stringify(obj) : obj);
    };
    const base = `http://localhost:${server.address().port}`;

    if (req.url === '/openai/images/edits') {
      const form = await new Request('http://x', { method: 'POST', headers: req.headers, body }).formData();
      seen.edits = { auth: req.headers.authorization, model: form.get('model'), size: form.get('size'), images: form.getAll('image[]').map((f) => f.name), prompt: form.get('prompt') };
      if (openaiStatus !== 200) return send(openaiStatus, { error: { message: 'nope' } });
      return send(200, { data: [{ b64_json: PNG.toString('base64') }], usage: { total_tokens: 42 } });
    }
    if (req.url === '/tripo/files') {
      const form = await new Request('http://x', { method: 'POST', headers: req.headers, body }).formData();
      seen.upload = { auth: req.headers.authorization, name: form.get('file').name };
      return send(200, { code: 0, data: { file_token: 'file_abc' } });
    }
    if (req.url === '/tripo/generation/image-to-model') {
      seen.task = JSON.parse(body.toString());
      return send(200, { code: 0, data: { task_id: 'task_1' } });
    }
    if (req.url === '/tripo/tasks/task_1') {
      seen.polls++;
      const status = taskStates[Math.min(i++, taskStates.length - 1)];
      const output = status === 'success' ? { model_url: `${base}/cdn/model.glb`, rendered_image_url: `${base}/cdn/preview.png` } : {};
      return send(200, { code: 0, data: { task_id: 'task_1', status, progress: status === 'success' ? 100 : 50, output, credits_consumed: 30, error_message: status === 'failed' ? 'bad image' : undefined } });
    }
    if (req.url === '/cdn/model.glb') return send(200, 'glTF-binary', 'model/gltf-binary');
    if (req.url === '/cdn/preview.png') return send(200, PNG, 'image/png');
    send(404, { code: 404 });
  });
  return new Promise((r) => server.listen(0, () => {
    const base = `http://localhost:${server.address().port}`;
    const cfg = config({ OPENAI_API_KEY: 'sk-test', TRIPO_API_KEY: 'tsk-test', OPENAI_BASE_URL: `${base}/openai`, TRIPO_BASE_URL: `${base}/tripo`, TRIPO_POLL_MS: '5', TRIPO_TIMEOUT_SEC: '2' });
    r({ server, cfg, seen });
  }));
}

async function fixtures() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'p2f-'));
  const master = path.join(dir, 'master.png');
  const photo = path.join(dir, 'person.jpg');
  await writeFile(master, PNG);
  await writeFile(photo, PNG);
  return { dir, master, photo };
}

test('사진 → 이미지 → 3D 전체 흐름', async () => {
  const { server, cfg, seen } = await mockServer();
  const { dir, master, photo } = await fixtures();
  const out = path.join(dir, 'out');
  try {
    const report = await run({ photoPath: photo, masterPath: master, outDir: out, cfg, log: () => {} });
    // OpenAI: 마스터가 먼저(Image 1), 체험자가 두 번째(Image 2)
    assert.deepEqual(seen.edits.images, ['image1-master.png', 'image2-person.jpg']);
    assert.equal(seen.edits.auth, 'Bearer sk-test');
    assert.equal(seen.edits.size, '1024x1536');
    assert.match(seen.edits.prompt, /^Create one new character/);
    // Tripo: 업로드 토큰으로 작업 생성
    assert.equal(seen.upload.auth, 'Bearer tsk-test');
    assert.deepEqual(seen.task, { input: 'file_abc', model: 'v3.1-20260211', texture: true, pbr: true, texture_quality: 'standard' });
    assert.equal(seen.polls, 3);
    assert.equal((await readFile(path.join(out, 'model.glb'), 'utf8')), 'glTF-binary');
    assert.deepEqual(await readFile(path.join(out, 'figure.png')), PNG);
    assert.equal(report.steps.model.credits, 30);
    assert.equal(report.steps.image.usage.total_tokens, 42);
  } finally { server.close(); }
});

test('--image 로 이미지 생성 건너뛰기', async () => {
  const { server, cfg, seen } = await mockServer({ taskStates: ['success'] });
  const { dir, master } = await fixtures();
  try {
    const report = await run({ imagePath: master, outDir: path.join(dir, 'o'), cfg, log: () => {} });
    assert.equal(seen.edits, null);
    assert.equal(report.steps.image, undefined);
    assert.ok(report.steps.model);
  } finally { server.close(); }
});

test('Tripo 작업 실패를 알린다', async () => {
  const { server, cfg } = await mockServer({ taskStates: ['running', 'failed'] });
  const { dir, master, photo } = await fixtures();
  try {
    await assert.rejects(run({ photoPath: photo, masterPath: master, outDir: path.join(dir, 'o'), cfg, log: () => {} }), /Tripo 작업 failed.*bad image/);
  } finally { server.close(); }
});

test('Tripo 시간 초과를 알린다', async () => {
  const { server, cfg } = await mockServer({ taskStates: ['running'] });
  const { dir, master } = await fixtures();
  cfg.tripoTimeoutMs = 50;
  try {
    await assert.rejects(run({ imagePath: master, outDir: path.join(dir, 'o'), cfg, log: () => {} }), /끝나지 않았습니다/);
  } finally { server.close(); }
});

test('OpenAI 오류를 알린다', async () => {
  const { server, cfg } = await mockServer({ openaiStatus: 403 });
  const { dir, master, photo } = await fixtures();
  try {
    await assert.rejects(run({ photoPath: photo, masterPath: master, outDir: path.join(dir, 'o'), cfg, log: () => {} }), /이미지 생성 실패: HTTP 403/);
  } finally { server.close(); }
});

test('지원하지 않는 형식 거부', () => {
  assert.equal(mimeOf('a.JPG'), 'image/jpeg');
  assert.throws(() => mimeOf('a.heic'), /지원하지 않는/);
});
