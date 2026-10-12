import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// 参考 PRD 3.3：最小必要权限
// - sidePanel：优先使用 Chromium Side Panel API
// - storage：少量编辑器偏好（chrome.storage.local）
// - activeTab：截图的备用授权路径
// - host 权限仅申请 YouTube（captureVisibleTab 在 YouTube 标签页据此授权）
export default defineConfig({
  srcDir: '.',
  entrypointsDir: 'entrypoints',
  outDir: '.output',
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'YouTube 学习笔记',
    short_name: 'YT笔记',
    description:
      '在 Brave 侧边栏中为 YouTube 视频记录富文本笔记、插入时间戳，并一键截图视频画面插入笔记。数据全部保存在本地。',
    version: '1.1.0',
    minimum_chrome_version: '114',
    permissions: ['sidePanel', 'storage', 'activeTab'],
    host_permissions:
      // E2E 验证构建：临时授予广 host（详见 README“权限说明”）
      process.env.WXT_E2E_BROAD === '1'
        ? ['<all_urls>']
        : ['https://www.youtube.com/*', 'https://m.youtube.com/*'],
    // 截图兜底授权：Chromium 116+ 起 captureVisibleTab 要求 activeTab 手势或广域 host。
    // 安装时不申请；仅在用户首次点击“截图”且 activeTab 手势授权不可用时，才弹窗请求。
    optional_host_permissions: ['<all_urls>'],
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      96: 'icons/96.png',
      128: 'icons/128.png',
    },
    action: {
      default_title: '打开 YouTube 学习笔记',
      default_icon: {
        16: 'icons/16.png',
        32: 'icons/32.png',
        48: 'icons/48.png',
        96: 'icons/96.png',
        128: 'icons/128.png',
      },
    },
  },
});
