import { useEffect, useState } from 'react';
import { AlertCircle, Info, X } from 'lucide-react';
import { subscribeNotices, type Notice } from '../lib/notice';

interface Toast extends Notice {
  visible: boolean;
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return subscribeNotices((notice) => {
      setToasts((prev) => [...prev.slice(-3), { ...notice, visible: true }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== notice.id));
      }, 5000);
    });
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-2 bottom-2 z-50 flex flex-col gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={
            'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-md ' +
            (t.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-slate-200 bg-white text-slate-700')
          }
        >
          {t.kind === 'error' ? (
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={15} className="mt-0.5 shrink-0 text-slate-400" />
          )}
          <span className="flex-1 leading-relaxed">{t.text}</span>
          <button
            type="button"
            className="shrink-0 text-slate-400 hover:text-slate-600"
            onClick={() =>
              setToasts((prev) => prev.filter((x) => x.id !== t.id))
            }
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
