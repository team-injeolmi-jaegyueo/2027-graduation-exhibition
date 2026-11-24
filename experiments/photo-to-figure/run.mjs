#!/usr/bin/env node
// 사용법:
//   node run.mjs --photo <체험자 사진> [--master <마스터 이미지>] [--out <폴더>]
//   node run.mjs --image <이미 만든 토이 이미지>        # 이미지 생성 건너뛰고 3D만
//   node run.mjs --photo <사진> --skip-3d               # 이미지만 (Tripo 크레딧 아낌)
//   node run.mjs --photo <사진> --route responses       # ② 대화 모델 + 이미지 생성 도구로
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, run, mimeOf, ROUTES } from './pipeline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const envFile = path.join(here, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values: a } = parseArgs({
  options: {
    photo: { type: 'string' },
    master: { type: 'string', default: path.join(repoRoot, 'local-data/photo-to-figure/master.png') },
    image: { type: 'string' },
    out: { type: 'string' },
    'skip-3d': { type: 'boolean', default: false },
    route: { type: 'string' }, // .env 의 OPENAI_ROUTE 보다 우선
  },
});

function stop(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

const cfg = config();
if (a.route) cfg.openaiRoute = a.route;
if (!ROUTES.includes(cfg.openaiRoute)) stop(`--route / OPENAI_ROUTE 는 ${ROUTES.join('·')} 중 하나여야 합니다: ${cfg.openaiRoute}`);
const needImage = !a.image;
const need3d = !a['skip-3d'];

if (needImage && !a.photo) stop('--photo <체험자 사진> 이 필요합니다. (이미 만든 이미지로 3D만 하려면 --image)');
if (needImage && !existsSync(a.master)) stop(`마스터 이미지가 없습니다: ${a.master}\n  local-data/photo-to-figure/master.png 에 두거나 --master 로 지정하세요.`);
for (const f of [needImage && a.photo, a.image].filter(Boolean)) {
  if (!existsSync(f)) stop(`파일이 없습니다: ${f}`);
  try { mimeOf(f); } catch (e) { stop(e.message); }
}
if (needImage && !cfg.openaiKey) stop(`OPENAI_API_KEY 가 없습니다. ${path.relative(process.cwd(), envFile)} 에 넣으세요 (.env.example 참고).`);
if (need3d && !cfg.tripoKey) stop(`TRIPO_API_KEY 가 없습니다. ${path.relative(process.cwd(), envFile)} 에 넣으세요 (.env.example 참고).`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = a.out ?? path.join(repoRoot, 'experiment-output/photo-to-figure', stamp);

try {
  await run({ photoPath: a.photo, masterPath: a.master, imagePath: a.image, skip3d: a['skip-3d'], outDir, cfg });
} catch (e) {
  stop(`실패: ${e.message}`);
}
