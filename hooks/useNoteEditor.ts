import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import type { JSONContent } from '@tiptap/react';
import { Timestamp } from '../editor/Timestamp';
import { Screenshot } from '../editor/Screenshot';

/**
 * 创建笔记用的 Tiptap 编辑器。
 * 自定义 Timestamp / Screenshot 扩展在后续阶段接入。
 */
export function useNoteEditor(onUpdateDoc: (doc: JSONContent) => void) {
  return useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        dropcursor: { color: '#10b981', width: 2 },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Timestamp,
      Screenshot,
      Placeholder.configure({
        placeholder: '为这个视频记点什么…\n支持标题、加粗、列表、链接、时间戳和视频截图。',
      }),
    ],
    content: null,
    editorProps: {
      attributes: {
        class: 'px-3 py-2 text-sm text-slate-800 min-h-[40vh]',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor }) => {
      onUpdateDoc(editor.getJSON());
    },
  });
}
