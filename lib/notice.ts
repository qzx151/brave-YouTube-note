// 极简全局通知（错误/提示），避免引入额外状态库

export type NoticeKind = 'error' | 'info';
export interface Notice {
  id: number;
  text: string;
  kind: NoticeKind;
}

type Listener = (notice: Notice) => void;
const listeners = new Set<Listener>();
let seq = 0;

export function notify(text: string, kind: NoticeKind = 'info'): void {
  const notice: Notice = { id: ++seq, text, kind };
  listeners.forEach((l) => l(notice));
}

export function subscribeNotices(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
