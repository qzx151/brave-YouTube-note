import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
import { Check, CloudOff, Loader2, MonitorPlay } from 'lucide-react';
import { useNoteEditor } from '../hooks/useNoteEditor';
import { NoteEditor } from './NoteEditor';
import {
  EMPTY_DOCUMENT,
  deleteAsset,
  gcAssets,
  loadNote,
  putAsset,
  upsertNote,
  type NoteMeta,
} from '../lib/db';
import { captureVideoFrame } from '../lib/screenshot';
import {
  buildMarkdownZip,
  copyNoteRich,
  downloadBytes,
  isDocEmpty,
} from '../lib/exporter';
import { sendToTab, type VideoState } from '../lib/messages';
import { getActiveYouTubeTab } from '../lib/tabs';
import { fetchActiveVideoState } from '../lib/playerBridge';
import { notify } from '../lib/notice';
import { Toaster } from './Toaster';

export type Surface = 'sidepanel' | 'tab';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface HeaderMeta {
  videoId: string;
  title: string;
  url: string;
  channelName: string | null;
}

function toMeta(state: VideoState): HeaderMeta {
  return {
    videoId: state.videoId as string,
    title: state.title,
    url: state.url,
    channelName: state.channelName,
  };
}

function toExportMeta(state: VideoState) {
  return {
    videoId: state.videoId as string,
    videoTitle: state.title,
    videoUrl: state.url,
    channelName: state.channelName,
  };
}

export function App({ surface }: { surface: Surface }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [meta, setMeta] = useState<HeaderMeta | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [pollError, setPollError] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);


  // latestStateRef：轮询到的最新页面状态；activeStateRef：当前已加载笔记对应的视频状态
  const latestStateRef = useRef<VideoState | null>(null);
  const activeStateRef = useRef<VideoState | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const latestDocRef = useRef<JSONContent>(EMPTY_DOCUMENT);
  const dirtyRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const switchChainRef = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback(
    async (videoId: string, doc: JSONContent, meta: NoteMeta) => {
      try {
        await upsertNote(videoId, doc, meta);
        await gcAssets(videoId, doc);
        dirtyRef.current = false;
        if (activeIdRef.current === videoId) setSaveStatus('saved');
      } catch (e) {
        console.error('[yt-notes] save failed', e);
        if (activeIdRef.current === videoId) setSaveStatus('error');
      }
    },
    [],
  );

  const enqueuePersist = useCallback(
    (videoId: string, doc: JSONContent, state: VideoState) => {
      const noteMeta: NoteMeta = {
        videoTitle: state.title,
        videoUrl: state.url,
        channelName: state.channelName,
      };
      saveQueueRef.current = saveQueueRef.current.then(
        () => persist(videoId, doc, noteMeta),
        () => persist(videoId, doc, noteMeta),
      );
    },
    [persist],
  );

  const scheduleSave = useCallback(
    (doc: JSONContent) => {
      latestDocRef.current = doc;
      dirtyRef.current = true;
      setSaveStatus('saving');
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        const id = activeIdRef.current;
        const state = activeStateRef.current;
        if (id && state?.videoId === id) {
          enqueuePersist(id, latestDocRef.current, state);
        }
      }, 700);
    },
    [enqueuePersist],
  );

  const editor = useNoteEditor(scheduleSave);

  const loadIntoEditor = useCallback(
    (doc: JSONContent, retries = 10): void => {
      if (!editor) return;
      // 中文 IME 组合输入期间不要重置文档
      if (editor.view.composing && retries > 0) {
        window.setTimeout(() => loadIntoEditor(doc, retries - 1), 100);
        return;
      }
      editor.commands.setContent(doc, false);
    },
    [editor],
  );

  const flushNow = useCallback(async () => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const id = activeIdRef.current;
    const state = activeStateRef.current;
    if (id && dirtyRef.current && state?.videoId === id && editor) {
      latestDocRef.current = editor.getJSON();
      enqueuePersist(id, latestDocRef.current, state);
    }
    await saveQueueRef.current;
  }, [editor, enqueuePersist]);

  const switchVideo = useCallback(
    async (state: VideoState | null) => {
      // 切换前先确保旧视频笔记落盘
      await flushNow();
      const nextId = state?.videoId ?? null;
      activeIdRef.current = nextId;
      activeStateRef.current = state;
      setActiveId(nextId);
      if (!nextId || !state) {
        setMeta(null);
        return;
      }
      setMeta(toMeta(state));
      const note = await loadNote(nextId);
      // 快速连续切换时丢弃过期结果
      if (activeIdRef.current !== nextId) return;
      latestDocRef.current = note?.document ?? EMPTY_DOCUMENT;
      loadIntoEditor(latestDocRef.current);
      dirtyRef.current = false;
      setSaveStatus(note ? 'saved' : 'idle');
    },
    [flushNow, loadIntoEditor],
  );

  // 轮询活动标签页视频状态（同时覆盖 YouTube SPA 内导航）
  useEffect(() => {
    if (!editor) return;
    let stopped = false;
    const tick = async () => {
      try {
        const tab = await getActiveYouTubeTab();
        const state =
          tab && tab.id !== undefined
            ? await sendToTab<VideoState>(tab.id, { type: 'GET_VIDEO_STATE' })
            : null;
        if (stopped) return;
        setPollError(null);
        latestStateRef.current = state;
        const nextId = state?.videoId ?? null;
        if (nextId !== activeIdRef.current) {
          // 串行化切换，避免快速 SPA 导航时并发加载/flush 互相覆盖
          switchChainRef.current = switchChainRef.current.then(() =>
            switchVideo(state),
          );
          await switchChainRef.current;
        } else if (state) {
          // 同一视频：刷新元数据快照（标题可能在导航后异步更新）
          activeStateRef.current = state;
          setMeta((prev) => {
            const next = toMeta(state);
            if (
              prev &&
              prev.title === next.title &&
              prev.channelName === next.channelName
            ) {
              return prev;
            }
            return next;
          });
        }
      } catch (e) {
        if (!stopped) setPollError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [editor, switchVideo]);

  // 侧边栏隐藏 / 页面卸载前尽力保存
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') void flushNow();
    };
    const onPageHide = () => {
      void flushNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, [flushNow]);

  const insertTimestamp = useCallback(async () => {
    if (!editor) return;
    try {
      const { state } = await fetchActiveVideoState();
      editor.chain().focus().insertTimestamp(state.currentTime).run();
    } catch (e) {
      notify(e instanceof Error ? e.message : '插入时间戳失败', 'error');
    }
  }, [editor]);

  const capture = useCallback(async () => {
    if (!editor || captureBusy) return;
    const videoId = activeIdRef.current;
    if (!videoId) {
      notify('请先打开一个 YouTube 视频', 'error');
      return;
    }

    // 异步截图前保存编辑器选区，完成后把图片插入原光标位置（PRD 3.4）
    const savedFrom = editor.state.selection.from;
    setCaptureBusy(true);
    let assetId: string | null = null;
    try {
      const frame = await captureVideoFrame();
      assetId = crypto.randomUUID();
      await putAsset({
        assetId,
        videoId,
        blob: frame.blob,
        mimeType: 'image/png',
        width: frame.width,
        height: frame.height,
        createdAt: Date.now(),
      });

      // 截图期间若编辑器失焦导致选区跑到末尾，恢复到截图前位置
      if (!editor.isFocused) {
        const pos = Math.min(savedFrom, editor.state.doc.content.size);
        editor.chain().setTextSelection(pos).run();
      }

      try {
        editor
          .chain()
          .focus()
          .insertScreenshot({
            assetId,
            seconds: Math.floor(frame.seconds),
            width: frame.width,
            height: frame.height,
            alt: '',
          })
          .run();
      } catch (insertErr) {
        // 插入失败：清理刚写入且未被引用的图片资源
        await deleteAsset(assetId).catch(() => undefined);
        throw insertErr;
      }

      // 立即调度自动保存（文档 + 资源关联 + GC）
      scheduleSave(editor.getJSON());
      notify('已插入视频截图', 'info');
    } catch (e) {
      console.error('[yt-notes] capture failed', e);
      notify(e instanceof Error ? e.message : '截图失败，请重试', 'error');
    } finally {
      setCaptureBusy(false);
    }
  }, [editor, captureBusy, scheduleSave]);

  /** 复制全文（含图片）到剪贴板，用于粘贴到 IMA / 飞书 / Notion 等 */
  const copyNote = useCallback(async () => {
    const state = activeStateRef.current;
    if (!editor || !state) return;
    const doc = editor.getJSON();
    if (isDocEmpty(doc)) {
      notify('当前笔记为空，没有可复制的内容', 'error');
      return;
    }
    try {
      const r = await copyNoteRich(toExportMeta(state), doc);
      const tail = r.missingImages > 0
        ? `（${r.missingImages} 张截图资源缺失）`
        : '';
      notify(
        r.images > 0
          ? `已复制全文，含 ${r.images} 张截图，可直接粘贴${tail}`
          : `已复制全文${tail}`,
        'info',
      );
    } catch (e) {
      console.error('[yt-notes] copy failed', e);
      notify(
        e instanceof Error ? e.message : '复制失败，请重试',
        'error',
      );
    }
  }, [editor]);

  /** 导出 Markdown + 图片 ZIP（Obsidian 等） */
  const exportMd = useCallback(async () => {
    const state = activeStateRef.current;
    if (!editor || !state) return;
    const doc = editor.getJSON();
    if (isDocEmpty(doc)) {
      notify('当前笔记为空，没有可导出的内容', 'error');
      return;
    }
    setExportBusy(true);
    try {
      // 导出前确保最新内容落盘
      await flushNow();
      const { filename, bytes, images } = await buildMarkdownZip(
        toExportMeta(state),
        editor.getJSON(),
      );
      downloadBytes(filename, bytes, 'application/zip');
      notify(
        `已导出 ${filename}（${images} 张截图）：解压后用 Obsidian 打开 note.md`,
        'info',
      );
    } catch (e) {
      console.error('[yt-notes] export failed', e);
      notify(e instanceof Error ? e.message : '导出失败，请重试', 'error');
    } finally {
      setExportBusy(false);
    }
  }, [editor, flushNow]);

  const retrySave = () => {
    const id = activeIdRef.current;
    const state = latestStateRef.current;
    if (id && state && editor) {
      setSaveStatus('saving');
      enqueuePersist(id, editor.getJSON(), state);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <MonitorPlay size={16} className="shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">
              {meta?.title ?? 'YouTube 学习笔记'}
            </div>
            {meta?.channelName && (
              <div className="truncate text-[11px] text-slate-400">
                {meta.channelName}
              </div>
            )}
          </div>
          {activeId && <SaveBadge status={saveStatus} onRetry={retrySave} />}
        </div>
        {surface === 'tab' && (
          <div className="mt-1 text-[11px] text-slate-400">
            独立页面模式（Side Panel 不可用时的降级入口）
          </div>
        )}
      </header>

      {pollError && activeId && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
          与 YouTube 页面通信失败：{pollError}
        </div>
      )}

      {activeId && editor ? (
        <div
          className={
            'flex min-h-0 flex-1 flex-col ' +
            (surface === 'tab' ? 'mx-auto w-full max-w-3xl' : '')
          }
        >
          <NoteEditor
            editor={editor}
            onInsertTimestamp={() => void insertTimestamp()}
            onCapture={() => void capture()}
            captureBusy={captureBusy}
            onCopyNote={() => void copyNote()}
            onExportMd={() => void exportMd()}
            exportBusy={exportBusy}
          />
        </div>
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <MonitorPlay size={36} className="text-slate-300" />
          <div className="text-sm font-medium text-slate-600">
            请打开一个 YouTube 视频
          </div>
          <div className="text-xs text-slate-400">
            在地址栏访问 youtube.com/watch?v=…
            <br />
            笔记面板会自动识别当前视频
          </div>
        </main>
      )}

      <Toaster />
    </div>
  );
}

function SaveBadge({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === 'saving') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
        <Loader2 size={12} className="animate-spin" />
        保存中…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-600">
        <Check size={12} />
        已保存
      </span>
    );
  }
  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
        title="点击重试保存"
      >
        <CloudOff size={12} />
        保存失败，重试
      </button>
    );
  }
  return null;
}
