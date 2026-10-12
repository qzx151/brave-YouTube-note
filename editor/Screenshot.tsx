// 自定义 Tiptap 块级节点：视频截图。
// 文档中只存 assetId / 时间戳等元数据，图片 Blob 独立存于 IndexedDB（PRD 2.4 / 4.3）
import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { Camera, Clock, ImageOff, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAsset } from '../lib/db';
import { formatTimestamp } from '../lib/video';
import { seekInActiveVideo } from '../lib/playerBridge';
import { notify } from '../lib/notice';

export interface ScreenshotAttrs {
  assetId: string;
  seconds: number;
  width: number;
  height: number;
  alt: string;
}

function ScreenshotNodeView({ node, selected }: NodeViewProps) {
  const assetId = String(node.attrs.assetId ?? '');
  const seconds = Number(node.attrs.seconds ?? 0);
  const width = Number(node.attrs.width ?? 0);
  const height = Number(node.attrs.height ?? 0);
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url = '';
    getAsset(assetId)
      .then((asset) => {
        if (cancelled) return;
        if (!asset) {
          setBroken(true);
          return;
        }
        url = URL.createObjectURL(asset.blob);
        setObjUrl(url);
      })
      .catch(() => {
        if (!cancelled) setBroken(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [assetId]);

  const onSeek = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    seekInActiveVideo(seconds).catch((err) => {
      notify(err instanceof Error ? err.message : '视频跳转失败', 'error');
    });
  };

  const ratioStyle =
    width > 0 && height > 0
      ? { aspectRatio: `${width} / ${height}` }
      : undefined;

  return (
    <NodeViewWrapper
      as="figure"
      contentEditable={false}
      className={
        'screenshot-figure ' + (selected ? 'selected-ring' : '')
      }
    >
      {objUrl ? (
        <img
          src={objUrl}
          alt={node.attrs.alt ? String(node.attrs.alt) : `视频截图 ${formatTimestamp(seconds)}`}
          draggable={false}
          style={ratioStyle}
        />
      ) : broken ? (
        <div
          className="flex items-center justify-center gap-2 bg-slate-100 px-3 py-8 text-xs text-slate-400"
          style={ratioStyle}
        >
          <ImageOff size={16} />
          截图资源缺失（可能已被清理）
        </div>
      ) : (
        <div
          className="flex items-center justify-center gap-2 bg-slate-100 px-3 py-8 text-xs text-slate-400"
          style={ratioStyle}
        >
          <Loader2 size={16} className="animate-spin" />
          截图加载中…
        </div>
      )}

      <figcaption>
        <Camera size={12} className="shrink-0 text-slate-400" />
        <span className="text-slate-500">截图 ·</span>
        <button
          type="button"
          className="timestamp-chip"
          title={`点击跳转到 ${formatTimestamp(seconds)}`}
          onClick={onSeek}
        >
          <Clock size={11} />
          {formatTimestamp(seconds)}
        </button>
      </figcaption>
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    screenshot: {
      insertScreenshot: (attrs: ScreenshotAttrs) => ReturnType;
    };
  }
}

export const Screenshot = Node.create({
  name: 'screenshot',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      assetId: {
        default: '',
        parseHTML: (el) =>
          el instanceof HTMLElement ? el.getAttribute('data-asset-id') ?? '' : '',
        renderHTML: (attrs) => ({ 'data-asset-id': String(attrs.assetId) }),
      },
      seconds: {
        default: 0,
        parseHTML: (el) =>
          el instanceof HTMLElement
            ? Number(el.getAttribute('data-seconds') ?? 0)
            : 0,
        renderHTML: (attrs) => ({ 'data-seconds': String(attrs.seconds) }),
      },
      width: {
        default: 0,
        renderHTML: (attrs) => ({ 'data-width': String(attrs.width) }),
        parseHTML: (el) =>
          el instanceof HTMLElement
            ? Number(el.getAttribute('data-width') ?? 0)
            : 0,
      },
      height: {
        default: 0,
        renderHTML: (attrs) => ({ 'data-height': String(attrs.height) }),
        parseHTML: (el) =>
          el instanceof HTMLElement
            ? Number(el.getAttribute('data-height') ?? 0)
            : 0,
      },
      alt: {
        default: '',
        renderHTML: (attrs) => ({ alt: String(attrs.alt ?? '') }),
        parseHTML: (el) =>
          el instanceof HTMLElement ? el.getAttribute('alt') ?? '' : '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-screenshot]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const seconds = Number(node.attrs.seconds ?? 0);
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-screenshot': '' }),
      ['img', { src: '', alt: node.attrs.alt ? String(node.attrs.alt) : '视频截图' }],
      ['figcaption', {}, `截图 · ${formatTimestamp(seconds)}`],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ScreenshotNodeView);
  },

  addCommands() {
    return {
      insertScreenshot:
        (attrs: ScreenshotAttrs) =>
        ({ state, dispatch, tr }) => {
          const schema = state.schema;
          const nodeType = schema.nodes.screenshot;
          const paraType = schema.nodes.paragraph;
          if (!nodeType || !paraType || !dispatch) return false;

          const insertPos = state.selection.from;
          const figure = nodeType.create(attrs);
          tr.insert(insertPos, figure);

          // 确保截图后面存在可继续输入的段落
          const afterPos = insertPos + figure.nodeSize;
          const after = tr.doc.nodeAt(afterPos);
          if (!after || after.type.name !== 'paragraph') {
            tr.insert(afterPos, paraType.create());
          }
          const $cursor = tr.doc.resolve(afterPos + 1);
          tr.setSelection(TextSelection.near($cursor));
          tr.scrollIntoView();
          dispatch(tr);
          return true;
        },
    };
  },
});
