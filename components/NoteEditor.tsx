import { EditorContent, type Editor } from '@tiptap/react';
import { Toolbar } from './Toolbar';

/**
 * 笔记编辑区：固定工具栏 + 可滚动正文。
 */
export function NoteEditor({
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
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <Toolbar
        editor={editor}
        onInsertTimestamp={onInsertTimestamp}
        onCapture={onCapture}
        captureBusy={captureBusy}
        onCopyNote={onCopyNote}
        onExportMd={onExportMd}
        exportBusy={exportBusy}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
