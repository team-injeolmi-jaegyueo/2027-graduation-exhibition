// 가상 분류 마스크로 머리 모양 판정 규칙을 확인한다. 실행: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, classifyHair, nearest, CAT } from './avatar.js';

const W = 400, H = 400;
// 얼굴: 가로 160px(120~280), 세로 200px(이마 120 ~ 턱 320), 눈썹 170
function landmarks() {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const set = (i, x, y) => { lm[i] = { x: x / W, y: y / H }; };
  set(10, 200, 120); set(152, 200, 320); set(234, 120, 220); set(454, 280, 220);
  set(105, 160, 170); set(334, 240, 170); set(70, 145, 172); set(300, 255, 172);
  return lm;
}
function maskWith(paint) {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inFace = ((x - 200) / 80) ** 2 + ((y - 220) / 100) ** 2 < 1;
    data[y * W + x] = paint(x, y, inFace) ?? (inFace ? CAT.faceSkin : CAT.background);
  }
  return { data, width: W, height: H };
}
const pixels = new Uint8ClampedArray(W * H * 4).fill(128);
const cap = (x, y) => ((x - 200) / 95) ** 2 + ((y - 215) / 120) ** 2 < 1 && y < 150; // 정수리

const cases = {
  Short: (x, y, f) => (cap(x, y) || (!f && y < 200 && Math.abs(x - 200) < 95) || (y >= 120 && y < 165 && Math.abs(x - 200) < 70) ? CAT.hair : null),
  Long: (x, y, f) => (cap(x, y) || (!f && Math.abs(x - 200) < 110 && Math.abs(x - 200) > 60 && y < 420) ? CAT.hair : null),
  Bob: (x, y, f) => (cap(x, y) || (!f && Math.abs(x - 200) < 100 && y < 315) ? CAT.hair : null),
  SidePart: (x, y, f) => ((((x - 200) / 95) ** 2 + ((y - 215) / 140) ** 2 < 1 && y < 120) || (!f && Math.abs(x - 200) < 95 && y < 190) ? CAT.hair : null),
  Buzz: (x, y) => (((x - 200) / 85) ** 2 + ((y - 200) / 90) ** 2 < 1 && y < 122 ? CAT.hair : null),
};

for (const [expected, paint] of Object.entries(cases)) {
  test(`머리 모양 판정: ${expected}`, () => {
    const r = measure(pixels, W, H, maskWith(paint), landmarks());
    assert.equal(r.faceFound, true);
    assert.equal(r.style, expected, JSON.stringify(r.stats));
  });
}

test('얼굴이 없으면 머리 모양 없이 색만 돌려준다', () => {
  const r = measure(pixels, W, H, maskWith(cases.Short), null);
  assert.equal(r.faceFound, false);
  assert.equal(r.style, null);
  assert.ok(r.colors.hair);
});

test('판정 규칙: 머리카락이 아주 적으면 아주 짧은 머리', () => {
  assert.equal(classifyHair({ hairArea: 0.05, belowChin: 1, bangs: 1, topThickness: 1 }), 'Buzz');
});

test('색은 가장 가까운 팔레트 색으로 맞춘다', () => {
  assert.equal(nearest([20, 15, 15], ['#2A2220', '#D8B26A']), '#2A2220');
  assert.equal(nearest([210, 170, 100], ['#2A2220', '#D8B26A']), '#D8B26A');
});
