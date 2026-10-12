// 截图服务：background 用 captureVisibleTab 抓**整页截图**，前端按视频矩形裁剪
// 处理 DPR / 浏览器缩放：用截图实际像素 ÷ viewport CSS 尺寸求缩放比（PRD 3.4）
import { sendToBackground } from './messages';
import { fetchActiveVideoState } from './playerBridge';
import { computeCropRect } from './geometry';
import { requestBroadHostPermission } from './permissions';

function isPermissionError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (code === 'CAPTURE_PERMISSION') return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /activeTab|all_urls|授权|权限|permission/i.test(msg);
}

async function requestCapture(): Promise<{ dataUrl: string }> {
  try {
    return await sendToBackground<{ dataUrl: string }>({
      type: 'CAPTURE_VISIBLE_TAB',
    });
  } catch (e) {
    // activeTab 手势授权不可用时，在用户点击手势内请求可选广域 host，然后重试一次
    if (isPermissionError(e)) {
      const granted = await requestBroadHostPermission();
      if (!granted) {
        throw new Error(
          '未获得截图授权：请在权限弹窗中点击“允许”，或先点击扩展图标打开笔记后再截图',
        );
      }
      return sendToBackground<{ dataUrl: string }>({
        type: 'CAPTURE_VISIBLE_TAB',
      });
    }
    throw e;
  }
}

export interface CroppedFrame {
  blob: Blob;
  width: number;
  height: number;
  /** 截图瞬间的视频播放时间（秒） */
  seconds: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('截图数据解码失败'));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片 Blob 转换失败'));
    }, mimeType);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'image/png';
  const binary = atob(body ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * 完整截图链路：读取视频矩形与时间 -> background 抓整页 -> 按实际比例裁剪视频区域
 */
export async function captureVideoFrame(): Promise<CroppedFrame> {
  const { state } = await fetchActiveVideoState();
  const rect = state.rect;
  if (!rect) {
    throw new Error('未找到视频播放器画面，请确认视频已加载并可见后重试');
  }

  // 1) 让 background 调用 captureVisibleTab 抓当前活动标签页（含授权兜底）
  const captured = await requestCapture();

  // 2) 解码整页截图
  const img = await loadImage(captured.dataUrl);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error('截图尺寸异常，请重试');
  }

  // 3) 实际像素 / CSS viewport => 裁剪矩形（含边界夹取与缩放比计算）
  const { sx, sy, sw, sh } = computeCropRect(
    rect,
    state.viewport,
    { width: img.naturalWidth, height: img.naturalHeight },
  );

  // 4) 裁剪
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建裁剪画布');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  // 6) 输出 Blob（toBlob 不可用时退回 dataURL）
  let blob: Blob;
  try {
    blob = await canvasToBlob(canvas, 'image/png');
  } catch {
    blob = dataUrlToBlob(canvas.toDataURL('image/png'));
  }

  return { blob, width: sw, height: sh, seconds: state.currentTime };
}
