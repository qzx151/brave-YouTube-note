// 纯几何计算：把视频元素的 CSS 像素矩形换算成截图像素上的裁剪矩形
// 独立成无依赖模块，便于单元测试（PRD 3.4）
import type { VideoRect } from './messages';

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PixelRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export const MIN_CROP_CSS_SIZE = 20;

export function computeCropRect(
  rect: VideoRect,
  viewport: ViewportSize,
  natural: ViewportSize,
): PixelRect {
  const vw = viewport.width;
  const vh = viewport.height;
  if (vw <= 0 || vh <= 0) {
    throw new Error('viewport 尺寸异常');
  }
  if (natural.width <= 0 || natural.height <= 0) {
    throw new Error('截图尺寸异常，请重试');
  }

  const scaleX = natural.width / vw;
  const scaleY = natural.height / vh;

  // 夹到 viewport 边界，防止负坐标/越界
  const x1 = Math.min(Math.max(rect.x, 0), vw);
  const y1 = Math.min(Math.max(rect.y, 0), vh);
  const x2 = Math.min(Math.max(rect.x + rect.width, 0), vw);
  const y2 = Math.min(Math.max(rect.y + rect.height, 0), vh);
  const cssW = x2 - x1;
  const cssH = y2 - y1;

  if (cssW < MIN_CROP_CSS_SIZE || cssH < MIN_CROP_CSS_SIZE) {
    throw new Error(
      '视频画面区域不可见或过小；若处于全屏模式，请先退出全屏再截图',
    );
  }

  return {
    sx: Math.round(x1 * scaleX),
    sy: Math.round(y1 * scaleY),
    sw: Math.max(1, Math.round(cssW * scaleX)),
    sh: Math.max(1, Math.round(cssH * scaleY)),
  };
}
