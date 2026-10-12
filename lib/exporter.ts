// 笔记搬运/导出：
// 1) copyNoteRich：把整篇笔记复制到剪贴板（text/html 富文本 + text/plain），图片以 data URI 内嵌，
//    适配 IMA 笔记、飞书、Notion 等在线编辑器；
// 2) buildMarkdownZip：导出 .md + images/*.png 的 ZIP，适配 Obsidian 等本地笔记软件。
import type { JSONContent } from '@tiptap/react';
import { formatTimestamp } from './video.ts';
import { createZip } from './zip.ts';

/** 递归收集文档中所有截图节点引用的 assetId（与 db.ts 中实现保持一致，纯函数便于测试） */
function collectAssetIdsFromDoc(doc: JSONContent | null | undefined): Set<string> {
  const ids = new Set<string>();
  const walk = (n: JSONContent | null | undefined) => {
    if (!n) return;
    if (n.type === 'screenshot') {
      const id = n.attrs?.assetId;
      if (typeof id === 'string' && id) ids.add(id);
    }
    for (const child of n.content ?? []) walk(child);
  };
  walk(doc);
  return ids;
}

export interface ExportMeta {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  channelName: string | null;
}

export interface SerializedNote {
  html: string;
  text: string;
  markdown: string;
  /** 成功嵌入的图片数量 */
  images: number;
  /** 资源缺失（数据库中找不到 Blob）的图片数量 */
  missingImages: number;
}

interface AssetData {
  mime: string;
  dataUrl: string;
  bytes: Uint8Array;
}

function watchUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(seconds)}s`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeMd(s: string): string {
  // 转义 Markdown 语法字符（不处理星号，避免和加粗标记冲突——正文里出现概率低）
  return s.replace(/([\\`[\]()<>|#])/g, '\\$1');
}

function textOf(node: JSONContent | null | undefined): string {
  if (!node) return '';
  if (node.type === 'timestamp') {
    return `[${formatTimestamp(Number(node.attrs?.seconds ?? 0))}]`;
  }
  if (node.type === 'hardBreak') return '\n';
  let out = node.text ?? '';
  for (const child of node.content ?? []) out += textOf(child);
  return out;
}

/** 笔记是否为空白（无文字、无时间戳、无截图） */
export function isDocEmpty(doc: JSONContent | null | undefined): boolean {
  if (!doc) return true;
  const t = textOf(doc).replace(/\s/g, '');
  return t.length === 0 && collectAssetIdsFromDoc(doc).size === 0;
}

// ---------- HTML（剪贴板富文本） ----------

function inlineHtml(
  node: JSONContent,
  videoId: string,
): string {
  if (node.type === 'hardBreak') return '<br>';
  if (node.type === 'timestamp') {
    const sec = Number(node.attrs?.seconds ?? 0);
    return `<a href="${watchUrl(videoId, sec)}">${formatTimestamp(sec)}</a>`;
  }
  let content = escapeHtml(node.text ?? '');
  for (const child of node.content ?? []) content += inlineHtml(child, videoId);
  const marks = node.marks ?? [];
  for (const mark of marks) {
    switch (mark.type) {
      case 'code':
        content = `<code>${content}</code>`;
        break;
      case 'bold':
        content = `<strong>${content}</strong>`;
        break;
      case 'italic':
        content = `<em>${content}</em>`;
        break;
      case 'strike':
        content = `<s>${content}</s>`;
        break;
      case 'link': {
        const href = String(mark.attrs?.href ?? '');
        content = href
          ? `<a href="${escapeHtml(href)}">${content}</a>`
          : content;
        break;
      }
    }
  }
  return content;
}

function blocksHtml(
  node: JSONContent,
  videoId: string,
  assets: Map<string, AssetData | null>,
): string {
  const inline = (n: JSONContent) => inlineHtml(n, videoId);
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((c) => blocksHtml(c, videoId, assets)).join('');
    case 'paragraph':
      return `<p>${(node.content ?? []).map(inline).join('')}</p>`;
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1);
      const tag = level === 1 ? 'h1' : 'h2';
      return `<${tag}>${(node.content ?? []).map(inline).join('')}</${tag}>`;
    }
    case 'blockquote':
      return `<blockquote>${(node.content ?? [])
        .map((c) => blocksHtml(c, videoId, assets))
        .join('')}</blockquote>`;
    case 'bulletList':
      return `<ul>${(node.content ?? [])
        .map((c) => blocksHtml(c, videoId, assets))
        .join('')}</ul>`;
    case 'orderedList':
      return `<ol>${(node.content ?? [])
        .map((c) => blocksHtml(c, videoId, assets))
        .join('')}</ol>`;
    case 'listItem': {
      // listItem 内通常是一个段落 + 可选嵌套列表
      const parts = (node.content ?? []).map((c) => {
        if (c.type === 'paragraph') {
          return `<p>${(c.content ?? []).map(inline).join('')}</p>`;
        }
        return blocksHtml(c, videoId, assets);
      });
      return `<li>${parts.join('')}</li>`;
    }
    case 'screenshot': {
      const assetId = String(node.attrs?.assetId ?? '');
      const sec = Number(node.attrs?.seconds ?? 0);
      const caption = `截图 · ${formatTimestamp(sec)}`;
      const asset = assets.get(assetId);
      if (asset) {
        return `<figure><img src="${asset.dataUrl}" alt="${escapeHtml(caption)}" style="max-width:100%;"/><figcaption>${escapeHtml('截图 · ')}<a href="${watchUrl(videoId, sec)}">${formatTimestamp(sec)}</a></figcaption></figure>`;
      }
      return `<p>[${escapeHtml(caption)}（图片资源缺失）]</p>`;
    }
    default:
      // 未知块节点：尽力渲染其内部内容
      if (node.content) {
        return `<p>${node.content.map(inline).join('')}</p>`;
      }
      return '';
  }
}

// ---------- Markdown ----------

function inlineMd(node: JSONContent, videoId: string): string {
  if (node.type === 'hardBreak') return '  \n';
  if (node.type === 'timestamp') {
    const sec = Number(node.attrs?.seconds ?? 0);
    return `[${formatTimestamp(sec)}](${watchUrl(videoId, sec)})`;
  }
  let content = escapeMd(node.text ?? '');
  for (const child of node.content ?? []) content += inlineMd(child, videoId);
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'code':
        content = `\`${content}\``;
        break;
      case 'bold':
        content = `**${content}**`;
        break;
      case 'italic':
        content = `*${content}*`;
        break;
      case 'strike':
        content = `~~${content}~~`;
        break;
      case 'link': {
        const href = String(mark.attrs?.href ?? '');
        if (href) content = `[${content}](${href})`;
        break;
      }
    }
  }
  return content;
}

function blocksMd(
  node: JSONContent,
  videoId: string,
  depth: number,
): string {
  const pad = '  '.repeat(depth);
  const inline = (n: JSONContent) => inlineMd(n, videoId);
  switch (node.type) {
    case 'doc':
      return (node.content ?? [])
        .map((c) => blocksMd(c, videoId, depth))
        .join('\n\n');
    case 'paragraph':
      return pad + (node.content ?? []).map(inline).join('');
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1);
      return `${'#'.repeat(level)} ${(node.content ?? []).map(inline).join('')}`;
    }
    case 'blockquote':
      return (node.content ?? [])
        .map((c) =>
          blocksMd(c, videoId, depth)
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n'),
        )
        .join('\n');
    case 'screenshot': {
      const assetId = String(node.attrs?.assetId ?? '');
      const sec = Number(node.attrs?.seconds ?? 0);
      const caption = `截图 ${formatTimestamp(sec)}`;
      return `![${caption}](images/${assetId}.png)`;
    }
    default:
      if (node.content) return pad + node.content.map(inline).join('');
      return '';
  }
}

// Markdown 列表需要区分有序/无序，预处理 listItem 时无法从子节点访问父节点，
// 因此在进入列表时给 listItem 做一次带标记的递归。
function listItemMd(
  item: JSONContent,
  videoId: string,
  depth: number,
  ordered: boolean,
  index: { n: number },
): string {
  const pad = '  '.repeat(depth);
  const inlineParts: string[] = [];
  const nested: string[] = [];
  for (const child of item.content ?? []) {
    if (child.type === 'paragraph') {
      inlineParts.push((child.content ?? []).map((c) => inlineMd(c, videoId)).join(''));
    } else if (child.type === 'bulletList') {
      nested.push(
        (child.content ?? [])
          .map((li) => listItemMd(li, videoId, depth + 1, false, index))
          .join('\n'),
      );
    } else if (child.type === 'orderedList') {
      nested.push(
        (child.content ?? [])
          .map((li) => listItemMd(li, videoId, depth + 1, true, index))
          .join('\n'),
      );
    } else {
      nested.push(blocksMd(child, videoId, depth + 1));
    }
  }
  const marker = ordered ? `${++index.n}. ` : '- ';
  const self = `${pad}${marker}${inlineParts.join(' ')}`;
  return [self, ...nested].join('\n');
}

function blocksMdRoot(node: JSONContent, videoId: string): string {
  if (node.type !== 'doc') {
    return blocksMd(node, videoId, 0);
  }
  const out: string[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'bulletList') {
      out.push(
        (child.content ?? [])
          .map((li) => listItemMd(li, videoId, 0, false, { n: 0 }))
          .join('\n'),
      );
    } else if (child.type === 'orderedList') {
      out.push(
        (child.content ?? [])
          .map((li) => listItemMd(li, videoId, 0, true, { n: 0 }))
          .join('\n'),
      );
    } else {
      out.push(blocksMd(child, videoId, 0));
    }
  }
  return out.join('\n\n');
}

// ---------- 资源加载 ----------

async function loadAssets(
  doc: JSONContent,
): Promise<Map<string, AssetData | null>> {
  const ids = collectAssetIdsFromDoc(doc);
  const map = new Map<string, AssetData | null>();
  await Promise.all(
    [...ids].map(async (id) => {
      const { getAsset } = await import('./db');
      const asset = await getAsset(id).catch(() => null);
      if (!asset) {
        map.set(id, null);
        return;
      }
      const buf = await asset.blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(
          ...bytes.subarray(i, i + chunkSize),
        );
      }
      const b64 = btoa(binary);
      map.set(id, {
        mime: asset.mimeType || 'image/png',
        dataUrl: `data:${asset.mimeType || 'image/png'};base64,${b64}`,
        bytes,
      });
    }),
  );
  return map;
}

// ---------- 对外 API ----------

/** 纯函数序列化：给定已加载的资源 Map 生成 HTML / 纯文本 / Markdown（便于单测） */
export function serializeFromAssets(
  meta: ExportMeta,
  doc: JSONContent,
  assets: Map<string, AssetData | null>,
  now: Date = new Date(),
): SerializedNote {
  let images = 0;
  let missingImages = 0;
  for (const v of assets.values()) {
    if (v) images += 1;
    else missingImages += 1;
  }
  const bodyHtml = blocksHtml(doc, meta.videoId, assets);
  const html = `<div class="yt-learning-notes-export">${bodyHtml}</div>`;
  const text = plainText(doc);
  const mdHeader =
    `# ${meta.videoTitle}\n\n` +
    `> 来源：[${meta.videoTitle}](${meta.videoUrl})  \n` +
    (meta.channelName ? `> 频道：${meta.channelName}  \n` : '') +
    `> 导出时间：${now.toLocaleString()}\n\n`;
  const markdown = mdHeader + blocksMdRoot(doc, meta.videoId) + '\n';
  return { html, text, markdown, images, missingImages };
}

/** 从 IndexedDB 读取截图资源后序列化 */
export async function serializeNote(
  meta: ExportMeta,
  doc: JSONContent,
): Promise<SerializedNote> {
  const assets = await loadAssets(doc);
  return serializeFromAssets(meta, doc, assets);
}

function plainText(node: JSONContent): string {
  const walk = (n: JSONContent, depth: number): string => {
    const pad = '  '.repeat(depth);
    switch (n.type) {
      case 'doc':
        return (n.content ?? []).map((c) => walk(c, 0)).join('\n\n');
      case 'heading':
        return (n.content ?? []).map((c) => textOf(c)).join('');
      case 'paragraph':
        return pad + (n.content ?? []).map((c) => textOf(c)).join('');
      case 'blockquote':
        return (n.content ?? [])
          .map((c) => `> ${walk(c, depth)}`)
          .join('\n');
      case 'bulletList':
        return (n.content ?? [])
          .map((li) => walkListItem(li, depth, false, { n: 0 }))
          .join('\n');
      case 'orderedList':
        return (n.content ?? [])
          .map((li) => walkListItem(li, depth, true, { n: 0 }))
          .join('\n');
      case 'screenshot': {
        const sec = Number(n.attrs?.seconds ?? 0);
        return `[截图 ${formatTimestamp(sec)}]`;
      }
      default:
        return n.content ? n.content.map((c) => textOf(c)).join('') : '';
    }
  };
  const walkListItem = (
    item: JSONContent,
    depth: number,
    ordered: boolean,
    idx: { n: number },
  ): string => {
    const pad = '  '.repeat(depth);
    const parts: string[] = [];
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph') {
        const marker = ordered ? `${++idx.n}. ` : '- ';
        parts.push(pad + marker + (child.content ?? []).map(textOf).join(''));
      } else if (child.type === 'bulletList') {
        parts.push(
          (child.content ?? [])
            .map((li) => walkListItem(li, depth + 1, false, idx))
            .join('\n'),
        );
      } else if (child.type === 'orderedList') {
        parts.push(
          (child.content ?? [])
            .map((li) => walkListItem(li, depth + 1, true, idx))
            .join('\n'),
        );
      }
    }
    return parts.join('\n');
  };
  return walk(node, 0);
}

function fallbackExecCopy(html: string, text: string): boolean {
  const host = document.createElement('div');
  host.setAttribute('contenteditable', 'true');
  host.style.position = 'fixed';
  host.style.left = '-9999px';
  host.style.top = '0';
  host.innerHTML = html;
  // 同时塞一份纯文本到 hidden 节点之外的应用无法选择；execCommand 复制会带 HTML 与纯文本
  document.body.appendChild(host);
  const range = document.createRange();
  range.selectNodeContents(host);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  sel?.removeAllRanges();
  host.remove();
  // text 参数在 execCommand 路径下由 HTML 自动派生，仅作返回兜底说明
  void text;
  return ok;
}

/** 复制全文（含内嵌图片）到剪贴板，供 IMA / 飞书 / Notion 等编辑器粘贴 */
export async function copyNoteRich(
  meta: ExportMeta,
  doc: JSONContent,
): Promise<{ images: number; missingImages: number }> {
  const serialized = await serializeNote(meta, doc);
  const clipboard = navigator.clipboard as Clipboard & {
    write?: (items: ClipboardItem[]) => Promise<void>;
  };
  if (clipboard?.write && typeof ClipboardItem !== 'undefined') {
    const item = new ClipboardItem({
      'text/html': new Blob([serialized.html], { type: 'text/html' }),
      'text/plain': new Blob([serialized.text], { type: 'text/plain' }),
    });
    await clipboard.write([item]);
  } else {
    const ok = fallbackExecCopy(serialized.html, serialized.text);
    if (!ok) throw new Error('浏览器拒绝了剪贴板写入，请检查剪贴板权限后重试');
  }
  return { images: serialized.images, missingImages: serialized.missingImages };
}

export function sanitizeFilename(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/** 构建 Markdown + images ZIP（Uint8Array），文件名返回给调用方触发下载 */
export async function buildMarkdownZip(
  meta: ExportMeta,
  doc: JSONContent,
): Promise<{ filename: string; bytes: Uint8Array; images: number }> {
  const assets = await loadAssets(doc);
  const serialized = serializeFromAssets(meta, doc, assets);
  const files: { path: string; data: Uint8Array }[] = [
    {
      path: 'note.md',
      data: new TextEncoder().encode(serialized.markdown),
    },
  ];
  for (const [id, asset] of assets) {
    if (asset) {
      files.push({ path: `images/${id}.png`, data: asset.bytes });
    }
  }
  const bytes = createZip(files);
  const filename = `${sanitizeFilename(meta.videoTitle, meta.videoId)}.zip`;
  return { filename, bytes, images: serialized.images };
}

/** 在扩展页面内触发浏览器下载（blob URL，无需 downloads 权限） */
export function downloadBytes(
  filename: string,
  bytes: Uint8Array,
  mime = 'application/octet-stream',
): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
