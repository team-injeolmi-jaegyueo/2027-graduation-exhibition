export const PARTS = [
  { id: 'torso', label: '몸통', indices: [11, 12, 23, 24] },
  { id: 'leftArm', label: '왼팔', indices: [11, 13, 15] },
  { id: 'rightArm', label: '오른팔', indices: [12, 14, 16] },
  { id: 'leftLeg', label: '왼다리', indices: [23, 25, 27] },
  { id: 'rightLeg', label: '오른다리', indices: [24, 26, 28] },
];
// Canonical image coordinates: original camera image, top-left origin, normalized.
// Mirror only at presentation time; anatomical landmark indices never swap.
export function point(p, width, height) {
  return { x: (1 - p.x) * width, y: p.y * height };
}
export function visibleParts(landmarks) {
  return PARTS.filter(part => part.indices.every(i => {
    const p = landmarks?.[i];
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && (p.visibility ?? 0) >= 0.6 && (p.presence ?? 1) >= 0.6;
  })).map(part => part.id);
}
export function demoLandmarks() {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 0, presence: 0 }));
  const values = { 11:[.62,.25],12:[.38,.25],13:[.72,.43],14:[.28,.43],15:[.76,.62],16:[.24,.62],23:[.58,.57],24:[.42,.57],25:[.6,.74],26:[.4,.74],27:[.62,.94],28:[.38,.94] };
  for (const [i,[x,y]] of Object.entries(values)) points[i] = {x,y,z:0,visibility:1,presence:1};
  return points;
}
