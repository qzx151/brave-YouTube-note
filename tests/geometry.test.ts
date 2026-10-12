import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCropRect } from '../lib/geometry.ts';

test('DPR=2 时裁剪矩形按 2 倍缩放', () => {
  const rect = { x: 100, y: 100, width: 640, height: 360 };
  const r = computeCropRect(
    rect,
    { width: 1280, height: 720 },
    { width: 2560, height: 1440 },
  );
  assert.deepEqual(r, { sx: 200, sy: 200, sw: 1280, sh: 720 });
});

test('DPR=1 时裁剪矩形与 CSS 像素一致', () => {
  const rect = { x: 0, y: 80, width: 854, height: 480 };
  const r = computeCropRect(
    rect,
    { width: 1280, height: 720 },
    { width: 1280, height: 720 },
  );
  assert.deepEqual(r, { sx: 0, sy: 80, sw: 854, sh: 480 });
});

test('浏览器缩放 1.25 倍（截图 1600x900 / viewport 1280x720）', () => {
  const rect = { x: 72, y: 80, width: 1136, height: 639 };
  const r = computeCropRect(
    rect,
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
  );
  assert.equal(r.sw, Math.round(1136 * 1.25));
  assert.equal(r.sh, Math.round(639 * 1.25));
  assert.equal(r.sx, Math.round(72 * 1.25));
});

test('矩形越界时被夹到 viewport 内', () => {
  const rect = { x: -200, y: -100, width: 2000, height: 1200 };
  const r = computeCropRect(
    rect,
    { width: 1280, height: 720 },
    { width: 1280, height: 720 },
  );
  assert.deepEqual(r, { sx: 0, sy: 0, sw: 1280, sh: 720 });
});

test('可见区域过小（全屏未退出等）应抛错', () => {
  assert.throws(() =>
    computeCropRect(
      { x: 100, y: 100, width: 10, height: 10 },
      { width: 1280, height: 720 },
      { width: 1280, height: 720 },
    ),
  );
});
