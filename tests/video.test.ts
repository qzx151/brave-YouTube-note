import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTimestamp, parseVideoId } from '../lib/video.ts';

test('parseVideoId: 标准 /watch 链接', () => {
  assert.equal(
    parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ',
  );
});

test('parseVideoId: 带额外参数的 /watch 链接', () => {
  assert.equal(
    parseVideoId('https://www.youtube.com/watch?v=abc-_123XYZ&t=42s&list=PL1'),
    'abc-_123XYZ',
  );
});

test('parseVideoId: youtu.be 短链', () => {
  assert.equal(parseVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('parseVideoId: 首页 / Shorts / 非视频页返回 null', () => {
  assert.equal(parseVideoId('https://www.youtube.com/'), null);
  assert.equal(parseVideoId('https://www.youtube.com/feed/subscriptions'), null);
  // MVP 仅支持普通视频页，Shorts 不识别
  assert.equal(
    parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    null,
  );
});

test('formatTimestamp: 不足一小时显示 MM:SS', () => {
  assert.equal(formatTimestamp(0), '00:00');
  assert.equal(formatTimestamp(7.9), '00:07');
  assert.equal(formatTimestamp(432), '07:12');
});

test('formatTimestamp: 超过一小时显示 HH:MM:SS', () => {
  assert.equal(formatTimestamp(3723), '01:02:03');
});

test('formatTimestamp: 负数与 NaN 安全回退', () => {
  assert.equal(formatTimestamp(-5), '00:00');
});
