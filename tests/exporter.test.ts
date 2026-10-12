import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JSONContent } from '@tiptap/react';
import {
  isDocEmpty,
  sanitizeFilename,
  serializeFromAssets,
  type ExportMeta,
} from '../lib/exporter.ts';
import { createZip } from '../lib/zip.ts';

const meta: ExportMeta = {
  videoId: 'dQw4w9WgXcQ',
  videoTitle: '测试视频: A/B?',
  videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  channelName: '某频道',
};

// 1x1 红色 PNG（合法 PNG，用于验证字节打包）
const png1x1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
  0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0x70, 0x61, 0x86, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const assetId = 'asset-1';

const doc: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: '课程要点' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '重点', marks: [{ type: 'bold' }] },
        { type: 'text', text: '与' },
        { type: 'text', text: '链接', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        { type: 'timestamp', attrs: { seconds: 73 } },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一条' }] }],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '第二条' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '嵌套' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'screenshot',
      attrs: { assetId, seconds: 74, width: 931, height: 524, alt: '' },
    },
    {
      type: 'screenshot',
      attrs: { assetId: 'missing', seconds: 5, width: 10, height: 10, alt: '' },
    },
  ],
};

test('isDocEmpty: 空文档/含内容文档判定', () => {
  assert.equal(isDocEmpty({ type: 'doc', content: [{ type: 'paragraph' }] }), true);
  assert.equal(isDocEmpty(doc), false);
  assert.equal(
    isDocEmpty({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      ],
    }),
    false,
  );
});

test('sanitizeFilename: 去除 Windows 非法字符并兜底', () => {
  assert.equal(sanitizeFilename('a/b:c*d?', 'fb'), 'a-b-c-d-');
  assert.equal(sanitizeFilename('   ', 'fb'), 'fb');
});

test('serializeFromAssets: HTML 含标题/加粗/链接/时间戳跳转/内嵌图片', () => {
  const assets = new Map<string, unknown>([
    [assetId, { mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', bytes: png1x1 }],
    ['missing', null],
  ]) as never;
  const s = serializeFromAssets(meta, doc, assets as never, new Date(1700000000000));
  assert.match(s.html, /<h1>课程要点<\/h1>/);
  assert.match(s.html, /<strong>重点<\/strong>/);
  assert.match(s.html, /<a href="https:\/\/example\.com">链接<\/a>/);
  assert.match(s.html, /watch\?v=dQw4w9WgXcQ&t=73s/);
  assert.match(s.html, /<img src="data:image\/png;base64,AAAA"/);
  assert.match(s.html, /截图 · <a href="[^"]+&t=74s">01:14<\/a>/);
  assert.match(s.html, /图片资源缺失/);
  assert.equal(s.images, 1);
  assert.equal(s.missingImages, 1);
});

test('serializeFromAssets: Markdown 含标题/列表/嵌套/图片相对路径/时间戳链接', () => {
  const assets = new Map<string, unknown>([
    [assetId, { mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', bytes: png1x1 }],
    ['missing', null],
  ]) as never;
  const s = serializeFromAssets(meta, doc, assets as never, new Date(1700000000000));
  assert.match(s.markdown, /# 测试视频/);
  assert.match(s.markdown, /^# 课程要点/m);
  assert.match(s.markdown, /\*\*重点\*\*/);
  assert.match(s.markdown, /- 第一条/);
  assert.match(s.markdown, /  - 嵌套/);
  assert.match(s.markdown, /\[01:13\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&t=73s\)/);
  assert.match(s.markdown, /!\[截图 01:14\]\(images\/asset-1\.png\)/);
});

test('serializeFromAssets: 纯文本包含时间戳与图片占位', () => {
  const assets = new Map<string, unknown>([
    [assetId, { mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', bytes: png1x1 }],
    ['missing', null],
  ]) as never;
  const s = serializeFromAssets(meta, doc, assets as never);
  assert.match(s.text, /课程要点/);
  assert.match(s.text, /\[01:13\]/);
  assert.match(s.text, /\[截图 01:14\]/);
});

test('createZip: 合法 ZIP 结构（签名、条目、EOCD、UTF-8 名）', () => {
  const zip = createZip([
    { path: 'note.md', data: new TextEncoder().encode('# hi\n'), date: new Date(1700000000000) },
    { path: 'images/a.png', data: png1x1, date: new Date(1700000000000) },
  ]);
  // 本地文件头
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  assert.equal(zip[2], 0x03);
  assert.equal(zip[3], 0x04);
  // EOCD 签名
  const eocd = zip.slice(zip.length - 22, zip.length - 18);
  assert.deepEqual([...eocd], [0x50, 0x4b, 0x05, 0x06]);
  // 文件名可被 UTF-8 解码找到
  const decoded = new TextDecoder().decode(zip);
  assert.ok(decoded.includes('note.md'));
  assert.ok(decoded.includes('images/a.png'));
  // 图片字节被原样包含
  assert.ok(zip.join(',').includes(png1x1.join(',')));
});

test('createZip: 重复路径与非法路径抛错', () => {
  assert.throws(() =>
    createZip([
      { path: 'a.md', data: new Uint8Array() },
      { path: 'a.md', data: new Uint8Array() },
    ]),
  );
  assert.throws(() =>
    createZip([{ path: 'bad//path', data: new Uint8Array() }]),
  );
});
