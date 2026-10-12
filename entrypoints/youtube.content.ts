// YouTube content script：读取视频状态（ID/标题/时间/矩形）、执行跳转
import type { Response, VideoState } from '../lib/messages';
import {
  getChannelName,
  getVideoElement,
  getVideoTitle,
  parseVideoId,
} from '../lib/video';

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://m.youtube.com/*'],
  runAt: 'document_idle',
  allFrames: false,
  main() {
    function readState(): VideoState {
      const url = location.href;
      const videoId = parseVideoId(url);
      const video = getVideoElement();

      let rect: VideoState['rect'] = null;
      if (video) {
        const r = video.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          rect = { x: r.left, y: r.top, width: r.width, height: r.height };
        }
      }

      return {
        videoId,
        title: getVideoTitle(),
        url,
        channelName: getChannelName(),
        currentTime: video ? video.currentTime : 0,
        paused: video ? video.paused : true,
        rect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    }

    function seek(seconds: number): { seekedTo: number } {
      const video = getVideoElement();
      if (!video) throw new Error('未找到视频播放器');
      const clamped = Math.max(0, Math.min(seconds, video.duration || seconds));
      // PRD 2.3：只跳转时间，保留播放/暂停状态。
      // YouTube 播放器在程序化 seek 后有时会自行恢复播放，
      // 因此若跳转前是暂停状态，在短时间窗口内确保维持暂停。
      const wasPaused = video.paused;
      video.currentTime = clamped;
      if (wasPaused) {
        video.pause();
        const guard = () => {
          if (video.closest('body') && video.paused === false) video.pause();
        };
        window.setTimeout(guard, 50);
        window.setTimeout(guard, 250);
      }
      return { seekedTo: clamped };
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      try {
        if (message?.type === 'GET_VIDEO_STATE') {
          const resp: Response<VideoState> = { ok: true, data: readState() };
          sendResponse(resp);
          return false;
        }
        if (message?.type === 'SEEK') {
          const data = seek(
            typeof message.seconds === 'number' ? message.seconds : 0,
          );
          const resp: Response<typeof data> = { ok: true, data };
          sendResponse(resp);
          return false;
        }
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        } satisfies Response<never>);
        return false;
      }
      return false;
    });
  },
});
