// 扩展各上下文之间的消息协议与通信辅助
// 上下文：side panel / 降级页（React）、background（service worker）、content script（YouTube）

export interface VideoRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoState {
  videoId: string | null;
  title: string;
  url: string;
  channelName: string | null;
  currentTime: number;
  paused: boolean;
  /** 视频元素相对 viewport 的矩形（CSS 像素） */
  rect: VideoRect | null;
  /** viewport CSS 尺寸，用于把截图像素换算回 CSS 像素 */
  viewport: { width: number; height: number };
}

export type RuntimeMessage =
  | { type: 'GET_VIDEO_STATE' }
  | { type: 'SEEK'; seconds: number }
  | { type: 'CAPTURE_VISIBLE_TAB' };

export type OkResponse<T> = { ok: true; data: T };
export type ErrResponse = {
  ok: false;
  error: string;
  code?: 'CAPTURE_PERMISSION' | 'NO_ACTIVE_TAB' | string;
};
export type Response<T> = OkResponse<T> | ErrResponse;

export const TIMEOUT_MS = 8000;

/** 向指定标签页的 content script 发消息，带超时；无接收方时 reject */
export function sendToTab<T>(tabId: number, message: RuntimeMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('请求超时：YouTube 页面未响应（请刷新该页面后重试）'));
    }, TIMEOUT_MS);

    try {
      chrome.tabs.sendMessage(tabId, message, (response: Response<T> | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        if (!response) {
          reject(new Error('页面未返回数据'));
          return;
        }
        if (response.ok) resolve(response.data);
        else reject(Object.assign(new Error(response.error), { code: response.code }));
      });
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** 向 background service worker 发消息，带超时 */
export function sendToBackground<T>(message: RuntimeMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('后台服务响应超时，请重试'));
    }, TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage(message, (response: Response<T> | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        if (!response) {
          reject(new Error('后台服务未返回数据'));
          return;
        }
        if (response.ok) resolve(response.data);
        else reject(Object.assign(new Error(response.error), { code: response.code }));
      });
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
