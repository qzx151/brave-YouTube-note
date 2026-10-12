// 面向编辑器的 YouTube 交互桥：读取当前视频状态 / 跳转时间
import { sendToTab, type VideoState } from './messages';
import { getActiveYouTubeTab } from './tabs';

export async function fetchActiveVideoState(): Promise<{
  tabId: number;
  state: VideoState;
}> {
  const tab = await getActiveYouTubeTab();
  if (!tab || tab.id === undefined) {
    throw new Error('没有活动的 YouTube 视频标签页');
  }
  const state = await sendToTab<VideoState>(tab.id, {
    type: 'GET_VIDEO_STATE',
  });
  if (!state.videoId) {
    throw new Error('当前标签页不是 YouTube 视频页');
  }
  return { tabId: tab.id, state };
}

/** 点击时间戳：跳转到指定秒数，不改变播放/暂停状态 */
export async function seekInActiveVideo(seconds: number): Promise<void> {
  const { tabId } = await fetchActiveVideoState();
  await sendToTab(tabId, { type: 'SEEK', seconds });
}
