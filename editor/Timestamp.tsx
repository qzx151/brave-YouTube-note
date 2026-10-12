// 自定义 Tiptap 内联节点：可点击的视频时间戳（结构化存储 seconds，不靠文本解析）
import { Node, mergeAttributes } from '@tiptap/core';
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import type { MouseEvent } from 'react';
import { Clock } from 'lucide-react';
import { formatTimestamp } from '../lib/video';
import { seekInActiveVideo } from '../lib/playerBridge';
import { notify } from '../lib/notice';

function TimestampNodeView({ node }: NodeViewProps) {
  const seconds = Number(node.attrs.seconds ?? 0);
  return (
    <NodeViewWrapper
      as="span"
      className="timestamp-chip"
      contentEditable={false}
      role="button"
      tabIndex={-1}
      title={`点击跳转到 ${formatTimestamp(seconds)}`}
      onClick={(e: MouseEvent<HTMLSpanElement>) => {
        e.preventDefault();
        e.stopPropagation();
        seekInActiveVideo(seconds).catch((err) => {
          notify(
            err instanceof Error ? err.message : '视频跳转失败',
            'error',
          );
        });
      }}
    >
      <Clock size={11} />
      {formatTimestamp(seconds)}
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    timestamp: {
      insertTimestamp: (seconds: number) => ReturnType;
    };
  }
}

export const Timestamp = Node.create({
  name: 'timestamp',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      seconds: {
        default: 0,
        parseHTML: (el) => {
          if (!(el instanceof HTMLElement)) return 0;
          return Number(el.getAttribute('data-seconds') ?? 0);
        },
        renderHTML: (attrs) => ({ 'data-seconds': String(attrs.seconds) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-timestamp]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-timestamp': '',
        class: 'timestamp-chip',
      }),
      formatTimestamp(Number(node.attrs.seconds ?? 0)),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TimestampNodeView);
  },

  addCommands() {
    return {
      insertTimestamp:
        (seconds: number) =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent([
              { type: 'timestamp', attrs: { seconds } },
              { type: 'text', text: ' ' },
            ])
            .run(),
    };
  },
});
