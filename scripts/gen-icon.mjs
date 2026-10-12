// 生成扩展图标 public/icon.png（WXT 会据此自动生成 16/32/48/96/128 等尺寸）
// 纯 Node + zlib，无第三方依赖：深色圆角方块 + 白色播放三角 + 笔记线条
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makePng(size, draw) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const i = (y * size + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  // 加 PNG 每行 filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(x, y, s) {
  // 圆角矩形背景（深灰蓝，避免紫色）
  const radius = s * 0.22;
  const inX = x >= radius || x <= s - radius;
  const corners = [
    [radius, radius], [s - radius, radius],
    [radius, s - radius], [s - radius, s - radius],
  ];
  let inside = x >= 0 && y >= 0 && x < s && y < s;
  if (x < radius && y < radius) inside = Math.hypot(x - radius, y - radius) <= radius;
  else if (x > s - radius && y < radius) inside = Math.hypot(x - (s - radius), y - radius) <= radius;
  else if (x < radius && y > s - radius) inside = Math.hypot(x - radius, y - (s - radius)) <= radius;
  else if (x > s - radius && y > s - radius) inside = Math.hypot(x - (s - radius), y - (s - radius)) <= radius;
  void inX; void corners;
  if (!inside) return [0, 0, 0, 0];

  const bg = [15, 23, 42, 255]; // slate-900

  // 播放三角形（白色），偏左上
  const tAx = s * 0.16, tAy = s * 0.30, tBx = s * 0.16, tBy = s * 0.70, tCx = s * 0.52, tCy = s * 0.50;
  const d = (px, py, ax, ay, bx, by, cx, cy) => {
    const v0x = cx - ax, v0y = cy - ay, v1x = bx - ax, v1y = by - ay, v2x = px - ax, v2y = py - ay;
    const dot00 = v0x * v0x + v0y * v0y, dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y, dot11 = v1x * v1x + v1y * v1y, dot12 = v1x * v2x + v1y * v2y;
    const inv = 1 / (dot00 * dot11 - dot01 * dot01);
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    return u >= 0 && v >= 0 && u + v < 1;
  };
  if (d(x, y, tAx, tAy, tBx, tBy, tCx, tCy)) return [255, 255, 255, 255];

  // 右侧笔记线条（emerald-400）
  const lineX0 = s * 0.60, lineX1 = s * 0.86;
  const lines = [0.34, 0.46, 0.58, 0.70];
  const thick = s * 0.045;
  for (const ly of lines) {
    if (x >= lineX0 && x <= lineX1 && Math.abs(y - ly * s) <= thick / 2) {
      return [52, 211, 153, 255]; // emerald-400
    }
  }
  return bg;
}

import { rmSync } from 'node:fs';

const iconsDir = new URL('../public/icons/', import.meta.url);
const iconsPath = iconsDir.pathname.replace(/^\//, '');
rmSync(iconsPath, { recursive: true, force: true });
mkdirSync(iconsPath, { recursive: true });

// 直接按目标尺寸逐像素绘制，避免缩放带来的锯齿
for (const size of [16, 32, 48, 96, 128]) {
  const png = makePng(size, draw);
  const target = new URL(`./${size}.png`, iconsDir);
  writeFileSync(target, png);
  console.log('icon written:', `${size}.png`, png.length, 'bytes');
}
