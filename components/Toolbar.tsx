import type { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Link2,
  Link2Off,
  Undo2,
  Redo2,
  Clock,
  Camera,
  Loader2,
  ClipboardCopy,
  FileArchive,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface BarButtonProps {
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

function BarButton({ title, onClick, active, disabled, children }: BarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={
        'flex h-8 w-8 items-center justify-center rounded-md transition-colors ' +
        (active
          ? 'bg-emerald-100 text-emerald-700'
          : 'text-slate-600 hover:bg-slate-200/70') +
        (disabled ? ' cursor-not-allowed opacity-40 hover:bg-transparent' : '')
      }
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />;
}

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function Toolbar({
  editor,
  onInsertTimestamp,
  onCapture,
  captureBusy,
  onCopyNote,
  onExportMd,
  exportBusy,
}: {
  editor: Editor;
  onInsertTimestamp?: () => void;
  onCapture?: () => void;
  captureBusy?: boolean;
  onCopyNote?: () => void;
  onExportMd?: () => void;
  exportBusy?: boolean;
}) {
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const input = window.prompt('输入链接地址', previous ?? 'https://');
    if (input === null) return;
    const url = input.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = normalizeUrl(url);
    const chain = editor.chain().focus();
    if (editor.state.selection.empty) {
      chain
        .insertContent({
          type: 'text',
          text: url,
          marks: [{ type: 'link', attrs: { href } }],
        })
        .run();
    } else {
      chain.extendMarkRange('link').setLink({ href }).run();
    }
  };

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-2 py-1.5">
      <BarButton
        title="标题 1"
        active={editor.isActive('heading', { level: 1 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 1 }).run()
        }
      >
        <Heading1 size={17} />
      </BarButton>
      <BarButton
        title="标题 2"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
      >
        <Heading2 size={17} />
      </BarButton>

      <Divider />

      <BarButton
        title="加粗 (Ctrl+B)"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={16} />
      </BarButton>
      <BarButton
        title="斜体 (Ctrl+I)"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={16} />
      </BarButton>
      <BarButton
        title="删除线"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={16} />
      </BarButton>

      <Divider />

      <BarButton
        title="无序列表"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={17} />
      </BarButton>
      <BarButton
        title="有序列表"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={17} />
      </BarButton>
      <BarButton
        title="引用块"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={16} />
      </BarButton>

      <Divider />

      <BarButton
        title="插入/编辑链接"
        active={editor.isActive('link')}
        onClick={setLink}
      >
        <Link2 size={16} />
      </BarButton>
      <BarButton
        title="移除链接"
        disabled={!editor.isActive('link')}
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        <Link2Off size={16} />
      </BarButton>

      <Divider />

      {onInsertTimestamp && (
        <BarButton title="插入当前视频时间戳" onClick={onInsertTimestamp}>
          <Clock size={16} />
        </BarButton>
      )}
      {onCapture && (
        <button
          type="button"
          title="截取当前视频画面并插入笔记"
          aria-label="截取当前视频画面"
          disabled={captureBusy}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCapture}
          className={
            'flex h-8 items-center gap-1 rounded-md bg-emerald-600 px-2 text-xs font-medium text-white hover:bg-emerald-700 ' +
            (captureBusy ? 'cursor-wait opacity-70' : '')
          }
        >
          {captureBusy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Camera size={15} />
          )}
          截图
        </button>
      )}

      <span className="ml-auto flex items-center gap-0.5">
        {onCopyNote && (
          <BarButton
            title="复制全文（含图片），可粘贴到 IMA 笔记 / 飞书 / Notion"
            disabled={exportBusy}
            onClick={onCopyNote}
          >
            <ClipboardCopy size={16} />
          </BarButton>
        )}
        {onExportMd && (
          <BarButton
            title="导出 Markdown（.md + 图片 ZIP，Obsidian 用）"
            disabled={exportBusy}
            onClick={onExportMd}
          >
            {exportBusy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileArchive size={16} />
            )}
          </BarButton>
        )}
        <BarButton
          title="撤销 (Ctrl+Z)"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={16} />
        </BarButton>
        <BarButton
          title="重做 (Ctrl+Y)"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={16} />
        </BarButton>
      </span>
    </div>
  );
}
