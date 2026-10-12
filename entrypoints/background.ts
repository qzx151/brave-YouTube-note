// Background service worker：
// 1) 配置 Side Panel，图标点击打开；不支持时降级为独立页面 notes.html
// 2) 处理 captureVisibleTab 截图请求（PRD 2.4 / 3.4）

export default defineBackground(() => {
  const sidePanelSupported =
    typeof chrome !== 'undefined' && typeof chrome.sidePanel !== 'undefined';

  async function enableSidePanel() {
    if (!sidePanelSupported) return;
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (e) {
      console.warn('[yt-notes] setPanelBehavior failed:', e);
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    void enableSidePanel();
  });
  chrome.runtime.onStartup.addListener(() => {
    void enableSidePanel();
  });
  void enableSidePanel();

  function openFallbackPage() {
    const url = chrome.runtime.getURL('notes.html');
    void chrome.tabs.create({ url });
  }

  // 当 Side Panel 不可用、或 setPanelBehavior 未生效时，兜底处理图标点击
  chrome.action.onClicked.addListener(async (tab) => {
    if (sidePanelSupported && tab?.windowId !== undefined) {
      try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        return;
      } catch (e) {
        console.warn('[yt-notes] sidePanel.open failed, fallback to page:', e);
      }
    }
    openFallbackPage();
  });

  // 截图：捕获当前活动标签页可视区域（原始整页截图，裁剪在前端完成）
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CAPTURE_VISIBLE_TAB') return false;

    (async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        if (!tab || tab.id === undefined) {
          sendResponse({ ok: false, error: '未找到活动标签页' });
          return;
        }
        if (
          tab.url &&
          !/^https:\/\/(www|m)\.youtube\.com\/|^https:\/\/youtu\.be\//.test(
            tab.url,
          )
        ) {
          sendResponse({ ok: false, error: '当前标签页不是 YouTube 视频页' });
          return;
        }
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'png',
        });
        sendResponse({ ok: true, data: { dataUrl } });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Chromium 116+：captureVisibleTab 需要 activeTab 手势或 <all_urls>
        if (
          /activeTab|all_urls|permission|not allowed|denied/i.test(msg)
        ) {
          sendResponse({
            ok: false,
            code: 'CAPTURE_PERMISSION',
            error:
              '截图授权不足：请先点击浏览器工具栏中的扩展图标打开笔记（授权当前标签页），或在弹出的授权窗口中允许截图',
          });
        } else {
          sendResponse({ ok: false, error: `截图失败：${msg}` });
        }
      }
    })();

    return true; // 异步响应
  });
});
