// 导出链路深度诊断：下载事件、窗口异常、控制台错误、剪贴板 HTML 片段
import { writeFileSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9223);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdpSession(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const eventLog = [];
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
    } else if (msg.method) {
      eventLog.push(msg);
    }
  });
  return {
    label,
    eventLog,
    ready,
    send: (m, p = {}) => {
      const i = ++id;
      ws.send(JSON.stringify({ id: i, method: m, params: p }));
      return new Promise((res, rej) => pending.set(i, { resolve: res, reject: rej }));
    },
    async eval(e, { awaitPromise = true } = {}) {
      const r = await this.send('Runtime.evaluate', {
        expression: e,
        awaitPromise,
        returnByValue: true,
        userGesture: true,
      });
      if (r.exceptionDetails) {
        return { __error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
      }
      return r.result.value;
    },
  };
}

async function main() {
  const report = [];
  const targets = await (await fetch(`${BASE}/json`)).json();
  const sw = targets.find(
    (t) => t.type === 'service_worker' && /background\.js$/.test(t.url),
  );
  const extId = /chrome-extension:\/\/([a-p]{32})/.exec(sw.url)?.[1];
  const browser = cdpSession(
    (await (await fetch(`${BASE}/json/version`)).json()).webSocketDebuggerUrl,
    'browser',
  );
  await browser.ready;
  const panelInfo = targets.find(
    (t) => t.type === 'page' && /sidepanel\.html/.test(t.url),
  );
  await browser.send('Target.activateTarget', { targetId: panelInfo.id });
  await sleep(900);
  const panel = cdpSession(panelInfo.webSocketDebuggerUrl, 'panel');
  await panel.ready;
  await panel.send('Page.enable');
  await panel.send('Runtime.enable');
  await panel.send('Log.enable');

  // 剪贴板授权（读回需要）
  await browser.send('Browser.grantPermissions', {
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    origin: `chrome-extension://${extId}`,
  });

  // 拦截 blob 下载响应，直接取走 ZIP 字节（绕过 headless 下载落盘不稳定）
  await panel.send('Fetch.enable', {
    patterns: [
      {
        urlPattern: 'blob:chrome-extension://*',
        requestStage: 'Response',
      },
    ],
  });
  const intercepted = [];
  const wsRaw = new WebSocket(panelInfo.webSocketDebuggerUrl);
  const rawReady = new Promise((r) => wsRaw.addEventListener('open', r));
  let rawId = 0;
  const rawPending = new Map();
  wsRaw.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && rawPending.has(msg.id)) {
      const p = rawPending.get(msg.id);
      rawPending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    } else if (msg.method === 'Fetch.requestPaused') {
      const params = msg.params;
      const handle = async () => {
        const body = await new Promise((res, rej) => {
          const i = ++rawId;
          rawPending.set(i, { resolve: res, reject: rej });
          wsRaw.send(
            JSON.stringify({
              id: i,
              method: 'Fetch.getResponseBody',
              params: { requestId: params.requestId },
            }),
          );
        });
        intercepted.push({ url: params.request.url, body });
        // 取消后续下载（字节已取走）
        const i2 = ++rawId;
        rawPending.set(i2, { resolve: () => {}, reject: () => {} });
        wsRaw.send(
          JSON.stringify({
            id: i2,
            method: 'Fetch.failRequest',
            params: { requestId: params.requestId, errorReason: 'Aborted' },
          }),
        );
      };
      handle().catch((e) => intercepted.push({ error: String(e) }));
    }
  });
  await rawReady;

  const downloadPath =
    new URL('../.tmp/downloads/', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    );
  report.push(`downloadPath=${downloadPath}`);
  await browser.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
    eventsEnabled: true,
  });
  await panel.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
    eventsEnabled: true,
  });

  // 页面内挂错误收集
  await panel.eval(`window.__errs=[];
    window.addEventListener('error', e=>__errs.push('error:'+String(e.message)));
    window.addEventListener('unhandledrejection', e=>__errs.push('rej:'+String(e.reason && e.reason.stack || e.reason)));`);

  // 1) 再点一次复制，把剪贴板 HTML 落盘以便检查
  await panel.eval(`document.querySelector('button[title^="复制全文"]').click()`);
  await sleep(2000);
  const clip = await panel.eval(`(async () => {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      if (it.types.includes('text/html')) {
        const t = await (await it.getType('text/html')).text();
        return {
          len: t.length,
          hasNote: t.includes('自动化测试笔记'),
          hasImg: t.includes('data:image/png;base64,'),
          watchLinks: (t.match(/watch\\?v=[a-zA-Z0-9_-]+&t=\\d+s/g) || []).slice(0, 4),
          head: t.slice(0, 400),
          aroundChip: t.includes('01:13') ? t.slice(Math.max(0, t.indexOf('01:13') - 200), t.indexOf('01:13') + 120) : 'NO 01:13',
        };
      }
    }
    return null;
  })()`);
  report.push('CLIP ' + JSON.stringify(clip, null, 1));

  // 2) 点导出（Fetch 拦截会在响应阶段取走 ZIP 字节）
  await panel.eval(`document.querySelector('button[title^="导出 Markdown"]').click()`);
  await sleep(7000);

  // 落盘拦截到的 ZIP 字节
  for (const item of intercepted) {
    if (item.body) {
      const bytes = Buffer.from(item.body.body, item.body.base64Encoded ? 'base64' : 'utf8');
      writeFileSync(new URL('../.tmp/intercepted-export.zip', import.meta.url), bytes);
      report.push(`INTERCEPTED ZIP ${item.url.slice(0, 60)} size=${bytes.length}`);
    } else {
      report.push('INTERCEPT ERR ' + JSON.stringify(item));
    }
  }

  const pageErrs = await panel.eval(`window.__errs`);
  report.push('PAGE ERRORS ' + JSON.stringify(pageErrs, null, 1));

  // 面板底部 toast 文本
  const toast = await panel.eval(
    `document.querySelector('.fixed.inset-x-2.bottom-2')?.textContent ?? ''`,
  );
  report.push(`TOAST=${toast}`);

  // 浏览器级下载事件
  const dlEvents = browser.eventLog
    .filter((e) => /download/i.test(e.method))
    .map((e) => `${e.method} ${JSON.stringify(e.params).slice(0, 400)}`);
  report.push('DOWNLOAD EVENTS\n' + (dlEvents.join('\n') || '(none)'));

  // 面板运行时异常/console error
  const panelBad = panel.eventLog
    .filter(
      (e) =>
        e.method === 'runtime.exceptionThrown' ||
        (e.method === 'log.entryAdded' && e.params?.entry?.level === 'error'),
    )
    .map(
      (e) =>
        e.params?.exceptionDetails?.exception?.description ??
        e.params?.entry?.text ??
        JSON.stringify(e.params),
    );
  report.push('PANEL BAD\n' + (panelBad.join('\n') || '(none)'));

  writeFileSync(new URL('../.tmp/export-diag.txt', import.meta.url), report.join('\n\n'), 'utf8');
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
