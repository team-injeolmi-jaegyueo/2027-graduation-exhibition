import { test } from 'node:test';
import assert from 'node:assert/strict';
import { point, visibleParts, demoLandmarks } from './pose.js';
test('mirroring preserves the same landmark mapping across image sizes', () => {
  assert.deepEqual(point({x:.25,y:.4},640,480),{x:480,y:192});
  assert.deepEqual(point({x:.25,y:.4},1280,720),{x:960,y:288});
});
test('occluded or out-of-frame wrist disables only its anatomical arm', () => {
  const pose = demoLandmarks();
  assert.equal(visibleParts(pose).length,5);
  pose[15].visibility = .2;
  assert.deepEqual(visibleParts(pose), ['torso','rightArm','leftLeg','rightLeg']);
  pose[15].visibility = 1; pose[15].x = 1.1;
  assert.equal(visibleParts(pose).includes('leftArm'),false);
});
test('no person and non-finite coordinates never render fabricated limbs', () => {
  assert.deepEqual(visibleParts([]),[]);
  const pose = demoLandmarks(); pose[25].y = NaN;
  assert.equal(visibleParts(pose).includes('leftLeg'),false);
});
