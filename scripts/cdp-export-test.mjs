// 验证「复制全文（含图片）」与「导出 Markdown ZIP」端到端链路。
// 前置：cdp-test.mjs 已在同一浏览器中为视频 A 建好含文字/时间戳/截图的笔记。
// 用法：Brave 以 --remote-debugging-port=$CDP_PORT 启动后，node scripts/cdp-export-test.mjs
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9223);
const BASE = `http://127.0.0.1:${PORT}`;
const downloadDir = new URL('../.tmp/downloads/', import.meta.url);
mkdirSync(downloadDir, { recursive: true });

const log = (...a) => console.log('[cdp-export]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(pathname) {
  return (await fetch(`${BASE}${pathname}`)).json();
}

function cdpSession(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error(`${label} ws error`)));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return {
    label,
    ready,
    send: (method, params = {}) => {
      const myId = ++id;
      ws.send(JSON.stringify({ id: myId, method, params }));
      return new Promise((resolve, reject) =>
        pending.set(myId, { resolve, reject }),
      );
    },
    async eval(expression, { awaitPromise = true } = {}) {
      const r = await this.send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture: true,
      });
      if (r.exceptionDetails) {
        throw new Error(
          r.exceptionDetails.exception?.description ??
            r.exceptionDetails.text ??
            'eval failed',
        );
      }
      return r.result.value;
    },
    close: () => ws.close(),
  };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
}

async function waitFor(fn, timeout = 20000, interval = 400, label = '') {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(interval);
  }
  throw new Error(`waitFor timeout: ${label} ${lastErr ? String(lastErr) : ''}`);
}

async function main() {
  await sleep(800);
  const targets = await http('/json');
  const sw = targets.find(
    (t) => t.type === 'service_worker' && /background\.js$/.test(t.url),
  );
  const extId = sw ? /chrome-extension:\/\/([a-p]{32})/.exec(sw.url)?.[1] : null;
  const panelInfo = targets.find(
    (t) => t.type === 'page' && /sidepanel\.html/.test(t.url),
  );
  if (!panelInfo) throw new Error('未找到 sidepanel 标签页（请先跑 cdp-test.mjs）');
  log('extension id:', extId);

  const browserWs = (await http('/json/version')).webSocketDebuggerUrl;
  const browser = cdpSession(browserWs, 'browser');
  await browser.ready;
  // 聚焦面板：剪贴板读写要求文档焦点；面板经 tabs 回退逻辑仍能锁定 YouTube 视频
  await browser.send('Target.activateTarget', { targetId: panelInfo.id });
  await sleep(900);
  const panel = cdpSession(panelInfo.webSocketDebuggerUrl, 'sidepanel');
  await panel.ready;
  await panel.send('Page.enable');
  await panel.send('Runtime.enable');
  await panel.send('Log.enable');

  const hasFocus = await panel.eval(`document.hasFocus()`);
  check('面板已聚焦（document.hasFocus）', hasFocus === true);

  // 确保笔记存在（cdp-test 已建；聚焦后仍能显示）
  const hasNote = await waitFor(
    async () =>
      panel.eval(
        `(() => (document.querySelector('.ProseMirror')?.innerText ?? '').includes('自动化测试笔记') && document.querySelectorAll('figure.screenshot-figure').length >= 1)()`,
      ),
    15000,
    500,
    'preexisting note',
  );
  check('前置笔记（含截图，聚焦后仍锁定视频）', !!hasNote);

  // ---------- 1. 复制全文（含图片） ----------
  // 授予剪贴板读写权限（headless 下 CDP 模拟用户授权）
  await browser
    .send('Browser.grantPermissions', {
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      origin: `chrome-extension://${extId}`,
    })
    .catch((e) => log('grantPermissions warn:', String(e)));

  await panel.eval(
    `document.querySelector('button[title^="复制全文"]').click()`,
  );
  await sleep(1500);

  const clip = await panel.eval(
    `(async () => {
      try {
        const items = await navigator.clipboard.read();
        const out = { types: items.map((i) => i.types) };
        for (const item of items) {
          if (item.types.includes('text/html')) {
            out.html = await (await item.getType('text/html')).text();
          }
          if (item.types.includes('text/plain')) {
            out.text = await (await item.getType('text/plain')).text();
          }
        }
        return out;
      } catch (e) {
        return { error: String(e) };
      }
    })()`,
  );
  log('clipboard types:', JSON.stringify(clip?.types));
  const htmlOk =
    typeof clip?.html === 'string' &&
    clip.html.includes('自动化测试笔记') &&
    clip.html.includes('data:image/png;base64,') &&
    /watch\?v=dQw4w9WgXcQ&t=73s/.test(clip.html);
  check(
    '剪贴板 text/html 含正文、内嵌图片 data URI 与时间戳跳转链接',
    !!htmlOk,
    clip?.error
      ? clip.error
      : `htmlLen=${clip?.html?.length ?? 0}, hasImg=${(clip?.html ?? '').includes('data:image/png')}, plainLen=${(clip?.text ?? '').length}`,
  );

  // ---------- 2. 导出 Markdown ZIP ----------
  // 允许下载到指定目录
  const downloadPath = process.platform === 'win32'
    ? new URL(downloadDir).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    : downloadDir.pathname;
  log('download path:', downloadPath);
  await browser.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
    eventsEnabled: true,
  });
  // 页面级兜底（headless 中部分版本仅在页面级生效）
  await panel.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
    eventsEnabled: true,
  });

  const before = new Set(readdirSync(downloadDir));
  await panel.eval(
    `document.querySelector('button[title^="导出 Markdown"]').click()`,
  );
  // 等待新 zip 出现
  let zipFile = null;
  try {
    zipFile = await waitFor(() => {
      const files = readdirSync(downloadDir).filter((f) => f.endsWith('.zip'));
      const fresh = files.filter((f) => !before.has(f));
      if (fresh.length === 0) return null;
      const name = fresh[0];
      const st = statSync(new URL(`./${name}`, downloadDir));
      if (st.size < 100) return null; // 下载未完成
      return { name, size: st.size };
    }, 15000, 400, 'zip download');
  } catch (e) {
    check('导出 ZIP 文件下载成功', false, e.message);
  }
  if (zipFile) {
    check('导出 ZIP 文件下载成功', true, `${zipFile.name} (${zipFile.size} B)`);
    writeFileSync(
      new URL('../.tmp/exported-zip.json', import.meta.url),
      JSON.stringify(zipFile),
    );
  }

  // 面板 Toast 反馈（Toaster 容器固定在底部，无 role）
  const toast = await panel.eval(
    `document.querySelector('.fixed.inset-x-2.bottom-2')?.textContent ?? ''`,
  );
  check('导出后出现成功 Toast', /已导出|ZIP/.test(toast), toast.slice(0, 120));

  browser.close();
  panel.close();

  const passed = results.filter((r) => r.ok).length;
  log(`\n==== ${passed}/${results.length} export checks passed ====`);
  writeFileSync(
    new URL('../.tmp/cdp-export-results.json', import.meta.url),
    JSON.stringify(results, null, 2),
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
