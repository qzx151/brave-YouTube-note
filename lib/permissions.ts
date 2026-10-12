// 截图权限：优先依赖点击扩展图标带来的 activeTab 手势授权；
// 不可用时（例如侧边栏长期打开后切换了标签页）按需请求可选的广域 host 权限。

export const SCREENSHOT_ORIGIN = '<all_urls>';

export async function hasBroadHostPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({
      origins: [SCREENSHOT_ORIGIN],
    });
  } catch {
    return false;
  }
}

/** 必须在用户点击手势的调用栈中调用；返回用户是否同意授权 */
export async function requestBroadHostPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.request({
      origins: [SCREENSHOT_ORIGIN],
    });
  } catch {
    return false;
  }
}
