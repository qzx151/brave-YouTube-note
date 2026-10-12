// Dexie / IndexedDB 数据层：笔记文档 + 截图 Blob 资源（PRD 第 4 节）
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { JSONContent } from '@tiptap/react';

export interface VideoNote {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  channelName: string | null;
  /** Tiptap/ProseMirror 文档 JSON */
  document: JSONContent;
  createdAt: number;
  updatedAt: number;
}

export interface ScreenshotAsset {
  assetId: string;
  videoId: string;
  /** 图片二进制（image/png） */
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
}

class NotesDB extends Dexie {
  videoNotes!: EntityTable<VideoNote, 'videoId'>;
  screenshotAssets!: Table<ScreenshotAsset, string>;

  constructor() {
    super('yt-learning-notes');
    this.version(1).stores({
      videoNotes: 'videoId, updatedAt',
      screenshotAssets: 'assetId, videoId, createdAt',
    });
  }
}

export const db = new NotesDB();

export const EMPTY_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

export async function loadNote(videoId: string): Promise<VideoNote | null> {
  return (await db.videoNotes.get(videoId)) ?? null;
}

export interface NoteMeta {
  videoTitle: string;
  videoUrl: string;
  channelName: string | null;
}

/** 新建或更新笔记；首次创建时设置 createdAt */
export async function upsertNote(
  videoId: string,
  document: JSONContent,
  meta: NoteMeta,
): Promise<number> {
  const now = Date.now();
  const existing = await db.videoNotes.get(videoId);
  const record: VideoNote = {
    videoId,
    videoTitle: meta.videoTitle,
    videoUrl: meta.videoUrl,
    channelName: meta.channelName,
    document,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.videoNotes.put(record);
  return now;
}

export async function putAsset(asset: ScreenshotAsset): Promise<void> {
  await db.screenshotAssets.put(asset);
}

export async function getAsset(assetId: string): Promise<ScreenshotAsset | null> {
  return (await db.screenshotAssets.get(assetId)) ?? null;
}

export async function deleteAsset(assetId: string): Promise<void> {
  await db.screenshotAssets.delete(assetId);
}

/** 递归收集文档中所有截图节点引用的 assetId */
export function collectAssetIds(
  doc: JSONContent | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  const walk = (node: JSONContent | null | undefined) => {
    if (!node) return;
    if (node.type === 'screenshot') {
      const id = node.attrs?.assetId;
      if (typeof id === 'string' && id) ids.add(id);
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return ids;
}

/**
 * 垃圾回收：删除该视频下未被当前文档引用的截图 Blob。
 * 自动保存后调用，可覆盖“单张截图被删除”和“整份笔记删除/清空”两种场景。
 */
export async function gcAssets(
  videoId: string,
  doc: JSONContent | null | undefined,
): Promise<number> {
  const referenced = collectAssetIds(doc);
  const assets = await db.screenshotAssets
    .where('videoId')
    .equals(videoId)
    .toArray();
  const orphans = assets.filter((a) => !referenced.has(a.assetId));
  await Promise.all(orphans.map((a) => db.screenshotAssets.delete(a.assetId)));
  return orphans.length;
}

/** 删除整份笔记及其全部截图资源 */
export async function deleteNoteWithAssets(videoId: string): Promise<void> {
  await db.transaction('rw', db.videoNotes, db.screenshotAssets, async () => {
    await db.screenshotAssets.where('videoId').equals(videoId).delete();
    await db.videoNotes.delete(videoId);
  });
}
