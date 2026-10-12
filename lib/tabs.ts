// 标签页查询辅助（side panel / 降级页使用）

const isYouTubeWatchUrl = (url?: string): boolean =>
  !!url &&
  (/^https:\/\/(www|m)\.youtube\.com\/watch\b/.test(url) ||
    /^https:\/\/youtu\.be\//.test(url));

/**
 * 获取当前要记笔记的 YouTube 视频标签页。
 * 优先当前窗口的活动标签；若活动标签不是 YouTube（例如 notes.html 降级页本身被聚焦，
 * 或用户切到了别的标签），回退到窗口内最近访问的 YouTube 视频标签。
 */
export async function getActiveYouTubeTab(): Promise<chrome.tabs.Tab | null> {
  const [active] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (active && isYouTubeWatchUrl(active.url)) return active;

  const videos = (await chrome.tabs.query({ lastFocusedWindow: true })).filter(
    (t) => isYouTubeWatchUrl(t.url),
  );
  if (videos.length === 0) return null;
  videos.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return videos[0] ?? null;
}
