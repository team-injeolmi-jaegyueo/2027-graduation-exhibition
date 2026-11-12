// 사진 → 아바타 외모(머리 모양·피부색·머리색·옷 색)
// 사진은 브라우저 안에서만 분석하고 어디에도 보내거나 저장하지 않는다.

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0';
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// selfie_multiclass 분류 번호
export const CAT = { background: 0, hair: 1, bodySkin: 2, faceSkin: 3, clothes: 4, others: 5 };

export const HAIR_STYLES = {
  Short: '짧은 앞머리', Buzz: '아주 짧은 머리', SidePart: '이마 보이는 머리', Bob: '단발', Long: '긴 머리',
};

// 동숲 느낌을 유지하려고 측정한 색을 가장 가까운 팔레트 색으로 맞춘다
const SKIN_PALETTE = ['#FFE7D6', '#FCDCC8', '#F3C9A9', '#E2B08A', '#C68E66', '#9C6A47', '#6E4A33'];
const HAIR_PALETTE = ['#2A2220', '#4A2E20', '#6B3E26', '#9A6A3F', '#D8B26A', '#9C3F2A', '#A8A39E', '#E58FA8', '#4E6FB8'];

// 머리 모양 판정 기준 (얼굴 높이 = 1)
export const HAIR_RULES = {
  minHairArea: 0.12,   // 얼굴 면적 대비 머리카락이 이보다 적으면 아주 짧은 머리
  longBelowChin: 0.35, // 옆머리 끝이 턱보다 이만큼 아래면 긴 머리
  bobBelowChin: -0.2,  // 턱 근처까지 내려오면 단발
  bangs: 0.35,         // 이마 영역의 머리카락 비율이 이보다 크면 앞머리 있음
  thinTop: 0.12,       // 정수리 머리 두께가 이보다 얇으면 아주 짧은 머리
};

let tasks = null;
async function loadTasks() {
  if (tasks) return tasks;
  const { FilesetResolver, ImageSegmenter, FaceLandmarker } = await import(`${VISION}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
  const [segmenter, face] = await Promise.all([
    ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: SEG_MODEL }, runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
    }),
    FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: FACE_MODEL }, runningMode: 'IMAGE', numFaces: 1 }),
  ]);
  tasks = { segmenter, face };
  return tasks;
}

/** canvas 속 사진을 분석한다. 반환: { style, colors, stats, mask, faceFound } */
export async function analyzePhoto(canvas) {
  const { segmenter, face } = await loadTasks();
  const seg = segmenter.segment(canvas);
  const m = seg.categoryMask;
  const mask = { data: new Uint8Array(m.getAsUint8Array()), width: m.width, height: m.height };
  seg.close();
  const lm = face.detect(canvas).faceLandmarks?.[0] ?? null;
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  return { ...measure(pixels, canvas.width, canvas.height, mask, lm), mask };
}

/** 픽셀·분류 마스크·얼굴 랜드마크로 색과 머리 모양을 계산한다 (순수 함수). */
export function measure(pixels, W, H, mask, lm) {
  const catAt = (x, y) => mask.data[Math.min(mask.height - 1, Math.floor(y * mask.height / H)) * mask.width
                                   + Math.min(mask.width - 1, Math.floor(x * mask.width / W))];
  const buckets = { [CAT.hair]: [], [CAT.faceSkin]: [], [CAT.clothes]: [] };
  const step = Math.max(1, Math.round(Math.sqrt((W * H) / 40000)));
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    const c = catAt(x, y);
    if (buckets[c]) { const i = (y * W + x) * 4; buckets[c].push([pixels[i], pixels[i + 1], pixels[i + 2]]); }
  }
  const avg = list => trimmedMean(list);
  const raw = { skin: avg(buckets[CAT.faceSkin]), hair: avg(buckets[CAT.hair]), clothes: avg(buckets[CAT.clothes]) };
  const colors = {
    skin: raw.skin ? nearest(raw.skin, SKIN_PALETTE) : null,
    hair: raw.hair ? nearest(raw.hair, HAIR_PALETTE) : null,
    clothes: raw.clothes ? toHex(softenClothes(raw.clothes)) : null,
  };
  if (!lm) return { faceFound: false, style: null, colors, stats: null };

  const P = i => ({ x: lm[i].x * W, y: lm[i].y * H });
  const top = P(10), chin = P(152), l = P(234), r = P(454);
  const faceH = chin.y - top.y, faceW = Math.abs(r.x - l.x), cx = (l.x + r.x) / 2;
  const browY = (P(105).y + P(334).y) / 2;
  const bx0 = Math.min(P(70).x, P(300).x), bx1 = Math.max(P(70).x, P(300).x);

  let area = 0, bangHair = 0, bangAll = 0, sideBottom = -Infinity, topMin = Infinity;
  const y0 = Math.max(0, top.y - faceH), y1 = Math.min(H - 1, chin.y + 1.6 * faceH);
  const x0 = Math.max(0, cx - 1.6 * faceW), x1 = Math.min(W - 1, cx + 1.6 * faceW);
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    const hair = catAt(x, y) === CAT.hair;
    if (x >= bx0 && x <= bx1 && y >= top.y && y <= browY - 0.02 * faceH) { bangAll++; if (hair) bangHair++; }
    if (!hair) continue;
    area++;
    const dx = Math.abs(x - cx);
    if (dx > 0.35 * faceW) sideBottom = Math.max(sideBottom, y);
    if (dx < 0.3 * faceW) topMin = Math.min(topMin, y);
  }
  const stats = {
    hairArea: (area * step * step) / (faceW * faceH),
    belowChin: Number.isFinite(sideBottom) ? (sideBottom - chin.y) / faceH : -1,
    bangs: bangAll ? bangHair / bangAll : 0,
    topThickness: Number.isFinite(topMin) ? (top.y - topMin) / faceH : 0,
  };
  return { faceFound: true, style: classifyHair(stats), colors, stats };
}

export function classifyHair(s, rules = HAIR_RULES) {
  if (s.hairArea < rules.minHairArea) return 'Buzz';
  if (s.belowChin > rules.longBelowChin) return 'Long';
  if (s.belowChin > rules.bobBelowChin) return 'Bob';
  if (s.bangs > rules.bangs) return 'Short';
  if (s.topThickness < rules.thinTop) return 'Buzz';
  return 'SidePart';
}

// ---------- 색 계산 ----------
function trimmedMean(list) {
  if (list.length < 30) return null;
  const sorted = list.map(c => [c, 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]]).sort((a, b) => a[1] - b[1]);
  const cut = Math.floor(sorted.length * 0.15);
  const mid = sorted.slice(cut, sorted.length - cut);
  const sum = mid.reduce((s, [c]) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0]);
  return sum.map(v => v / mid.length);
}
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const toHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

function toLab([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const k = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * k(Y) - 16, 500 * (k(X) - k(Y)), 200 * (k(Y) - k(Z))];
}
export function nearest(rgb, palette) {
  // 사진은 보통 실제보다 어둡게 찍혀서 밝기 차이는 덜 중요하게 본다
  const a = toLab(rgb);
  let best = palette[0], bestD = Infinity;
  for (const hex of palette) {
    const b = toLab(hexToRgb(hex));
    const d = 0.5 * (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (d < bestD) { bestD = d; best = hex; }
  }
  return best;
}
function softenClothes([r, g, b]) {
  // HSL로 바꿔 너무 어둡거나 칙칙한 옷 색을 살짝 살린다
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = Math.min(0.85, Math.max(0.28, l * 1.15));
  s = Math.min(1, s * 1.15);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const hue = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return s === 0 ? [l * 255, l * 255, l * 255] : [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}
