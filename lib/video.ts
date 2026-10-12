// YouTube 页面内的视频识别 / 时间格式化等纯逻辑（content script 使用）

/** 从 URL 解析 YouTube videoId；仅支持普通视频页 /watch 与 youtu.be 短链 */
export function parseVideoId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{6,}$/.test(id) ? id : null;
    }
    if (
      url.hostname === 'www.youtube.com' ||
      url.hostname === 'm.youtube.com' ||
      url.hostname === 'youtube.com'
    ) {
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v');
        return id && /^[\w-]{6,}$/.test(id) ? id : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 秒数 -> MM:SS；超过一小时 -> HH:MM:SS */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 找到 YouTube 主视频元素 */
export function getVideoElement(): HTMLVideoElement | null {
  return (
    document.querySelector<HTMLVideoElement>('video.html5-main-video') ??
    document.querySelector<HTMLVideoElement>('video')
  );
}

export function getVideoTitle(): string {
  const metaTitle = document.querySelector(
    'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string',
  )?.textContent;
  if (metaTitle && metaTitle.trim()) return metaTitle.trim();
  return document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
}

export function getChannelName(): string | null {
  const el = document.querySelector(
    '#owner ytd-channel-name a, ytd-channel-name a, #channel-name a',
  )?.textContent;
  return el && el.trim() ? el.trim() : null;
}
