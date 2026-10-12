// 最终导出验证：
// A) 真实按钮「复制全文」→ 读回剪贴板，校验正文/内嵌图片/时间戳链接
// B) 打开 ?test=1 面板，走真实 buildMarkdownZip 生成 ZIP，Node 端解析 ZIP，
//    校验 note.md 与 images/*.png 真实内容
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9223);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdpSession(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
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
    } else if (msg.method) events.push(msg);
  });
  return {
    events,
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
        throw new Error(
          r.exceptionDetails.exception?.description ??
            r.exceptionDetails.text ??
            'eval failed',
        );
      }
      return r.result.value;
    },
  };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
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

/** 解析 STORE 方式 ZIP 中的条目（本项目所有文件均为 STORE） */
function parseStoreZip(buf) {
  const files = [];
  let i = 0;
  while (i < buf.length - 30) {
    const sig = buf.readUInt32LE(i);
    if (sig === 0x04034b50) {
      const method = buf.readUInt16LE(i + 8);
      const compSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
      const dataStart = i + 30 + nameLen + extraLen;
      if (method === 0) {
        files.push({ name, data: buf.slice(dataStart, dataStart + compSize) });
      }
      i = dataStart + compSize;
    } else {
      i += 1;
    }
  }
  return files;
}

async function main() {
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

  // ---------- A. 复制全文按钮 → 剪贴板 ----------
  let normalPanel = targets.find(
    (t) => t.type === 'page' && /sidepanel\.html/.test(t.url),
  );
  await browser.send('Target.activateTarget', { targetId: normalPanel.id });
  await sleep(900);
  const panel = cdpSession(normalPanel.webSocketDebuggerUrl, 'panel');
  await panel.ready;
  await panel.send('Runtime.enable');
  await panel.send('Log.enable');

  await browser.send('Browser.grantPermissions', {
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    origin: `chrome-extension://${extId}`,
  });

  await panel.eval(`document.querySelector('button[title^="复制全文"]').click()`);
  await sleep(2000);
  const clip = await panel.eval(`(async () => {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      if (it.types.includes('text/html')) {
        const t = await (await it.getType('text/html')).text();
        const p = it.types.includes('text/plain')
          ? await (await it.getType('text/plain')).text()
          : '';
        return { html: t, text: p };
      }
    }
    return null;
  })()`);
  // 浏览器回读时 & 会被规范化为 &amp;，两种写法都算正确
  const linkOk =
    !!clip &&
    /watch\?v=dQw4w9WgXcQ(?:&|&amp;)t=73s/.test(clip.html) &&
    clip.html.includes('data:image/png;base64,') &&
    clip.html.includes('自动化测试笔记');
  check(
    '复制按钮：剪贴板 text/html 含正文、内嵌图片与时间戳链接',
    !!linkOk,
    clip ? `htmlLen=${clip.html.length}, textLen=${clip.text.length}` : 'clip null',
  );
  const plainOk =
    !!clip &&
    clip.text.includes('自动化测试笔记') &&
    clip.text.includes('[01:13]');
  check('复制按钮：text/plain 含正文与时间戳', !!plainOk);

  // ---------- B. buildMarkdownZip → 真实 ZIP 解析 ----------
  // 关闭旧测试面板
  const oldTests = (await (await fetch(`${BASE}/json`)).json()).filter(
    (t) => t.type === 'page' && /[?&]test=1/.test(t.url),
  );
  for (const t of oldTests) {
    await browser.send('Target.closeTarget', { targetId: t.id }).catch(() => {});
  }
  const created = await browser.send('Target.createTarget', {
    url: `chrome-extension://${extId}/sidepanel.html?test=1`,
  });
  const testPanelId = created.targetId;
  const testPanelInfo = await waitFor(async () => {
    const list = await (await fetch(`${BASE}/json`)).json();
    const t = list.find((x) => x.id === testPanelId);
    if (!t) return null;
    const s = cdpSession(t.webSocketDebuggerUrl, 'tp');
    await s.ready;
    try {
      const ready = await s.eval(`!!window.__test`);
      return ready ? t : null;
    } catch {
      return null;
    }
  }, 15000, 500, 'test panel hook');
  const tp = cdpSession(testPanelInfo.webSocketDebuggerUrl, 'testpanel');
  await tp.ready;

  const zipInfo = await tp.eval(`(async () => {
    const note = await window.__test.loadNote('dQw4w9WgXcQ');
    if (!note) return { error: 'note not found' };
    const meta = {
      videoId: note.videoId,
      videoTitle: note.videoTitle,
      videoUrl: note.videoUrl,
      channelName: note.channelName,
    };
    const r = await window.__test.buildMarkdownZip(meta, note.document);
    let binary = '';
    const cs = 0x8000;
    for (let i = 0; i < r.bytes.length; i += cs) {
      binary += String.fromCharCode(...r.bytes.subarray(i, i + cs));
    }
    return { filename: r.filename, images: r.images, b64: btoa(binary) };
  })()`);
  check('测试钩子：ZIP 生成成功并已 base64 取回', !!zipInfo?.b64, zipInfo?.error ?? zipInfo?.filename);

  if (zipInfo?.b64) {
    const zipBuf = Buffer.from(zipInfo.b64, 'base64');
    mkdirSync(new URL('../.tmp/verified/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../.tmp/verified/verified-export.zip', import.meta.url), zipBuf);
    const files = parseStoreZip(zipBuf);
    console.log(
      'ZIP entries:',
      files.map((f) => `${f.name}(${f.data.length})`).join(', '),
    );
    const noteMd = files.find((f) => f.name === 'note.md');
    const imgs = files.filter((f) => /^images\/.+\.png$/.test(f.name));
    check('ZIP 含 note.md', !!noteMd);
    check('ZIP 含 images/*.png 且数量匹配', imgs.length === zipInfo.images, `${imgs.length} vs ${zipInfo.images}`);
    const mdText = noteMd?.data.toString('utf8') ?? '';
    const mdOk =
      mdText.includes('来源：') &&
      /\[01:13\]\(https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&t=73s\)/.test(mdText) &&
      /!\[截图 01:1[0-9]\]\(images\/[a-zA-Z0-9_-]+\.png\)/.test(mdText);
    check('note.md 含来源、时间戳跳转链接与图片引用', mdOk);
    const pngOk = imgs.every(
      (f) => f.data.length > 10_000 && f.data[0] === 0x89 && f.data[1] === 0x50,
    );
    check('images 内为真实 PNG 字节（非占位）', pngOk && imgs.length > 0);
  }

  // 运行时异常汇总
  const bad = panel.events.filter(
    (e) =>
      e.method === 'runtime.exceptionThrown' ||
      (e.method === 'log.entryAdded' && e.params?.entry?.level === 'error'),
  );
  check('面板无未捕获运行时异常', bad.length === 0,
    bad.map((e) => e.params?.exceptionDetails?.text ?? e.params?.entry?.text).join('; '));

  writeFileSync(
    new URL('../.tmp/cdp-export-verify.json', import.meta.url),
    JSON.stringify(results, null, 2),
  );
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== ${passed}/${results.length} export checks passed ====`);
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
