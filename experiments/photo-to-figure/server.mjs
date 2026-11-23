#!/usr/bin/env node
// 앱(저장소 루트의 정적 파일)을 서빙하면서 POST /api/figure 로 토이 이미지를 만들어 줍니다.
// API 키는 이 서버에만 있고 브라우저로 가지 않습니다. 사진은 메모리에서만 쓰고 저장하지 않습니다.
//
//   node experiments/photo-to-figure/server.mjs            # 실제 OpenAI 호출
//   FIGURE_MOCK=1 node experiments/photo-to-figure/server.mjs  # 키 없이: 몇 초 뒤 마스터 이미지를 돌려줌
//   → http://localhost:8137/app/
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, generateFigureImage, fromDataUrl, imageFile, loadPrompt } from './pipeline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const envFile = path.join(here, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.PORT || 8137);
const MOCK = process.env.FIGURE_MOCK === '1';
const MOCK_DELAY = Number(process.env.FIGURE_MOCK_DELAY_MS || 4000);
const MASTER = process.env.FIGURE_MASTER || path.join(root, 'local-data/photo-to-figure/master.png');
const MAX_BODY = 12 * 1024 * 1024;
const cfg = config();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.glb': 'model/gltf-binary', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp4': 'video/mp4', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};
// 저장소에서 서빙하지 않을 경로 (비밀·로컬 자료)
const BLOCKED = [/(^|\/)\./, /^local-data\//, /^experiment-output\//, /node_modules\//];

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('사진이 너무 큽니다.'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleFigure(req, res) {
  const t0 = Date.now();
  let photo;
  try {
    photo = fromDataUrl(JSON.parse(await readBody(req)).photo);
  } catch (e) {
    return json(res, e.status || 400, { error: e.message });
  }
  if (!existsSync(MASTER)) return json(res, 500, { error: `마스터 이미지가 없습니다: ${path.relative(root, MASTER)}` });

  try {
    let png;
    if (MOCK) {
      await new Promise((r) => setTimeout(r, MOCK_DELAY));
      png = (await imageFile(MASTER)).buf;
    } else {
      if (!cfg.openaiKey) return json(res, 503, { error: 'OPENAI_API_KEY가 설정되지 않았습니다.' });
      ({ png } = await generateFigureImage({ master: await imageFile(MASTER), person: photo, prompt: await loadPrompt(), cfg }));
    }
    const seconds = (Date.now() - t0) / 1000;
    console.log(`[figure] ${MOCK ? 'mock' : cfg.imageModel} ${seconds.toFixed(1)}s`);
    json(res, 200, { image: `data:image/png;base64,${png.toString('base64')}`, seconds, mock: MOCK });
  } catch (e) {
    console.error('[figure] 실패:', e.message);
    json(res, 502, { error: e.message });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (BLOCKED.some((re) => re.test(rel))) return json(res, 404, { error: 'not found' });
  let file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return json(res, 404, { error: 'not found' });
  try {
    let st = await stat(file);
    if (st.isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { location: url.pathname + '/' }); return res.end(); }
      file = path.join(file, 'index.html'); st = await stat(file);
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size });
    if (req.method === 'HEAD') return res.end();
    res.end(await readFile(file));
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/figure') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST만 가능합니다.' });
    return handleFigure(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`앱: http://localhost:${PORT}/app/`);
  console.log(MOCK ? `모의 모드: ${MOCK_DELAY}ms 뒤 마스터 이미지를 돌려줍니다.` : `이미지 모델: ${cfg.imageModel}${cfg.openaiKey ? '' : ' (OPENAI_API_KEY 없음 — 요청 시 오류)'}`);
});
