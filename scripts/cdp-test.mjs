// 通过 Chrome DevTools Protocol 在真实 Brave 中做端到端验证（无第三方依赖）
// 用法：先以 --remote-debugging-port=9222 --load-extension=<out> 启动 Brave，再 node scripts/cdp-test.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9222);
const BASE = `http://127.0.0.1:${PORT}`;
const shotsDir = new URL('../.tmp/shots/', import.meta.url);
mkdirSync(shotsDir, { recursive: true });

const log = (...a) => console.log('[cdp]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(pathname, method = 'GET') {
  const res = await fetch(`${BASE}${pathname}`, { method });
  return res.json();
}

function cdpSession(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', (e) => reject(new Error(`${label} ws error`)));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
      if (msg.method === 'runtime.exceptionThrown') {
        log(`!! ${label} exception:`, msg.params?.exceptionDetails?.text);
      }
      if (msg.method === 'log.entryAdded' && msg.params?.entry?.level === 'error') {
        log(`!! ${label} console error:`, msg.params.entry.text);
      }
    }
  });
  return {
    label,
    ready,
    events,
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
    async shot(name) {
      const r = await this.send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(r.data, 'base64');
      const url = new URL(`./${name}.png`, shotsDir);
      writeFileSync(url, buf);
      log(`screenshot saved: ${name}.png (${buf.length} bytes)`);
    },
    close: () => ws.close(),
  };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
}

const idbCounts = `(async () => {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open('yt-learning-notes');
    req.onerror = () => reject(String(req.error));
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['videoNotes','screenshotAssets'], 'readonly');
      const n1 = tx.objectStore('videoNotes').count();
      const n2 = tx.objectStore('screenshotAssets').count();
      Promise.all([
        new Promise(r => n1.onsuccess = () => r(n1.result)),
        new Promise(r => n2.onsuccess = () => r(n2.result)),
      ]).then(([notes, assets]) => resolve({ notes, assets }));
    };
  });
})()`;

async function waitFor(fn, timeout = 30000, interval = 500, label = '') {
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
  await sleep(1000);
  // 1) 找目标
  const targets = await http('/json');
  const sw = targets.find(
    (t) => t.type === 'service_worker' && /background\.js$/.test(t.url),
  );
  const extId = sw ? /chrome-extension:\/\/([a-p]{32})/.exec(sw.url)?.[1] : null;
  log('extension id:', extId);
  check('扩展 Service Worker 已注册并加载', !!sw, sw?.url ?? '未找到 background.js SW');

  let yt = targets.find(
    (t) => t.type === 'page' && /youtube\.com\/watch/.test(t.url),
  );
  if (!yt) throw new Error('未找到 YouTube 标签页目标');

  const browserWs = (await http('/json/version')).webSocketDebuggerUrl;
  const browser = cdpSession(browserWs, 'browser');
  await browser.ready;

  const ytPage = cdpSession(yt.webSocketDebuggerUrl, 'youtube');
  await ytPage.ready;
  await ytPage.send('Page.enable');
  await ytPage.send('Runtime.enable');
  await ytPage.send('Log.enable');

  // 2) 等视频元素
  try {
    await waitFor(
      async () =>
        ytPage.eval(`!!document.querySelector('video.html5-main-video')`),
      30000,
      500,
      'video element',
    );
    check('YouTube 视频页与播放器加载', true);
  } catch (e) {
    const body = await ytPage
      .eval(`document.body ? document.body.innerText.slice(0,500) : 'no body'`)
      .catch(() => 'unknown');
    check('YouTube 视频页与播放器加载', false, `${e.message}; body=${body}`);
    throw e;
  }

  const ytInfo0 = await ytPage.eval(`(() => {
    const v = document.querySelector('video.html5-main-video');
    return { href: location.href, title: document.title, hasVideo: !!v, paused: v ? v.paused : null };
  })()`);
  log('youtube:', JSON.stringify(ytInfo0));
  await sleep(500);
  await ytPage.shot('01-youtube');

  // 3) 在后台标签打开 sidepanel.html，并把焦点切回 YouTube（模拟真实侧边栏旁置场景）
  // 重新获取一次目标列表，避免会话恢复导致 id 失效
  const freshTargets = await http('/json');
  yt =
    freshTargets.find(
      (t) => t.type === 'page' && /youtube\.com\/watch/.test(t.url),
    ) ?? yt;
  // 先关闭会话恢复的旧面板标签
  const oldPanels = freshTargets.filter(
    (t) => t.type === 'page' && /sidepanel\.html|notes\.html/.test(t.url),
  );
  for (const p of oldPanels) {
    await browser
      .send('Target.closeTarget', { targetId: p.id })
      .catch(() => {});
  }
  await sleep(500);
  const created = await browser.send('Target.createTarget', {
    url: `chrome-extension://${extId}/sidepanel.html`,
  });
  const panelTargetId = created.targetId;
  await sleep(1500);
  await browser
    .send('Target.activateTarget', { targetId: yt.id })
    .catch((e) => log('activate yt warn:', String(e)));
  await sleep(500);

  const list2 = await http('/json');
  let panelInfo = list2.find((t) => t.id === panelTargetId);
  if (!panelInfo) {
    panelInfo = list2.find(
      (t) => t.type === 'page' && /sidepanel\.html/.test(t.url),
    );
  }
  const panel = cdpSession(panelInfo.webSocketDebuggerUrl, 'sidepanel');
  await panel.ready;
  await panel.send('Page.enable');
  await panel.send('Runtime.enable');
  await panel.send('Log.enable');

  // 4) 面板识别视频
  try {
    await waitFor(
      async () => {
        const hasEditor = await panel.eval(
          `!!document.querySelector('.ProseMirror')`,
        );
        return hasEditor;
      },
      20000,
      500,
      'panel editor',
    );
    check('侧边栏识别 YouTube 视频并挂载编辑器', true);
  } catch (e) {
    const header = await panel
      .eval(`document.body.innerText.slice(0,300)`)
      .catch(() => '?');
    check('侧边栏识别 YouTube 视频并挂载编辑器', false, `${e.message}; ${header}`);
  }
  const headerTitle = await panel.eval(
    `document.querySelector('header')?.innerText ?? ''`,
  );
  log('panel header:', headerTitle.replace(/\n/g, ' | '));

  // 5) 输入文字：先在编辑器中放置光标，再用 CDP Input.insertText 派发真实输入
  await panel.eval(`(() => {
    const el = document.querySelector('.ProseMirror');
    el.focus();
    const p = el.querySelector('p');
    const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  })()`);
  await panel.send('Input.insertText', { text: '自动化测试笔记：加粗与列表' });
  await sleep(200);
  await panel.eval(`document.querySelector('button[title="加粗 (Ctrl+B)"]').click()`);
  await panel.send('Input.insertText', { text: '重要内容' });
  await sleep(200);
  await panel.eval(`document.querySelector('button[title="加粗 (Ctrl+B)"]').click()`);
  await sleep(200);
  const typedText = await panel.eval(
    `document.querySelector('.ProseMirror')?.innerText ?? ''`,
  );
  check(
    '富文本输入进入编辑器（含加粗）',
    /自动化测试笔记/.test(typedText) && /重要内容/.test(typedText),
    typedText.replace(/\n/g, '\\n').slice(0, 120),
  );

  // 6) 时间戳：先把视频跳到 73s，再插入
  await ytPage.eval(`document.querySelector('video.html5-main-video').currentTime = 73`);
  await sleep(400);
  await panel.eval(
    `document.querySelector('button[title="插入当前视频时间戳"]').click()`,
  );
  await sleep(600);
  const chipText = await panel.eval(
    `Array.from(document.querySelectorAll('.timestamp-chip')).map(e=>e.textContent.trim())`,
  );
  check('插入当前视频时间戳（结构化节点）', /01:13/.test(JSON.stringify(chipText)), JSON.stringify(chipText));

  // 7) 点击时间戳跳转，且不改变播放/暂停状态
  // 用 YouTube 原生播放按钮显式暂停（真实用户路径），确保暂停守护验证确定性
  await ytPage.eval(`(() => {
    const v = document.querySelector('video.html5-main-video');
    const btn = document.querySelector('button.ytp-play-button');
    if (!v.paused) btn?.click();
  })()`);
  await sleep(700);
  const pausedBefore = await ytPage.eval(
    `document.querySelector('video.html5-main-video').paused`,
  );
  await ytPage.eval(`document.querySelector('video.html5-main-video').currentTime = 5`);
  await sleep(300);
  await panel.eval(`document.querySelector('.ProseMirror .timestamp-chip').click()`);
  await sleep(400);
  const seekSample = async () =>
    ytPage.eval(`(() => {
      const v = document.querySelector('video.html5-main-video');
      return { t: v.currentTime, paused: v.paused };
    })()`);
  const afterSeek1 = await seekSample();
  await sleep(700);
  const afterSeek2 = await seekSample();
  check(
    '点击时间戳跳转到对应秒数且不改变播放状态',
    pausedBefore === true &&
      afterSeek1.t >= 70 &&
      afterSeek1.t <= 76 &&
      afterSeek1.paused === true &&
      afterSeek2.paused === true,
    `t1=${afterSeek1.t}/p1=${afterSeek1.paused}, t2=${afterSeek2.t}/p2=${afterSeek2.paused}, pausedBefore=${pausedBefore}`,
  );

  // 8) 一键截图并插入
  await panel.eval(
    `document.querySelector('button[title="截取当前视频画面并插入笔记"]').click()`,
  );
  let figInfo = null;
  try {
    figInfo = await waitFor(async () => {
      const v = await panel.eval(`(() => {
        const f = document.querySelector('figure.screenshot-figure');
        if (!f) return null;
        const img = f.querySelector('img');
        return {
          exists: true,
          hasBlob: img ? img.src.startsWith('blob:') : false,
          naturalW: img ? img.naturalWidth : 0,
          caption: f.querySelector('figcaption')?.textContent?.trim() ?? '',
        };
      })()`);
      return v && v.hasBlob && v.naturalW > 100 ? v : null;
    }, 20000, 500, 'screenshot figure');
    check(
      '截图裁剪后以 Blob 图片插入笔记并带时间戳',
      true,
      `${figInfo.naturalW}px, caption=${figInfo.caption}`,
    );
  } catch (e) {
    check('截图裁剪后以 Blob 图片插入笔记并带时间戳', false, e.message);
  }

  // 9) IndexedDB 持久化
  await sleep(1500);
  const counts1 = await panel.eval(idbCounts);
  check(
    '笔记与截图 Blob 已写入 IndexedDB',
    counts1.notes >= 1 && counts1.assets >= 1,
    JSON.stringify(counts1),
  );

  // 10) 校验裁剪结果确实是视频区域而非整页：对比截图宽高 < viewport
  const cropDims = await panel.eval(`(() => {
    const img = document.querySelector('figure.screenshot-figure img');
    return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  })()`);
  const viewport = await ytPage.eval(
    `({w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio})`,
  );
  const croppedNotFullpage =
    cropDims &&
    cropDims.w < viewport.w * viewport.dpr - 50 &&
    cropDims.h < viewport.h * viewport.dpr - 50;
  check(
    '裁剪尺寸小于整页截图（不是整页网页）',
    !!croppedNotFullpage,
    `crop=${JSON.stringify(cropDims)} viewport=${JSON.stringify(viewport)}`,
  );

  // 11) 刷新后面板内容恢复（文本/时间戳/图片从 IDB 重建 ObjectURL）
  await panel.send('Page.reload');
  let restored = null;
  try {
    restored = await waitFor(async () => {
      const v = await panel.eval(`(() => {
        const txt = document.querySelector('.ProseMirror')?.innerText ?? '';
        const img = document.querySelector('figure.screenshot-figure img');
        return {
          text: txt,
          chip: document.querySelector('.ProseMirror .timestamp-chip')?.textContent?.trim(),
          imgLoaded: img ? img.complete && img.naturalWidth > 100 : false,
        };
      })()`);
      return v.imgLoaded && v.chip ? v : null;
    }, 20000, 500, 'restore after reload');
    check(
      '刷新面板后文本、时间戳与截图均恢复',
      /自动化测试笔记/.test(restored.text) &&
        /01:13/.test(restored.chip) &&
        restored.imgLoaded,
      JSON.stringify({ chip: restored.chip, imgLoaded: restored.imgLoaded }),
    );
  } catch (e) {
    check('刷新面板后文本、时间戳与截图均恢复', false, e.message);
  }

  // 12) 视频隔离：导航到第二个视频应为空笔记
  const idB = 'aqz-KE-bpKQ'; // Big Buck Bunny（官方开放影片，稳定可播）
  const videoB = `https://www.youtube.com/watch?v=${idB}`;
  await ytPage.send('Page.navigate', { url: videoB });
  let navBok = true;
  try {
    await waitFor(
      async () => (await ytPage.eval(`location.href`)).includes(idB),
      18000,
      500,
      'navigate to video B',
    );
  } catch {
    navBok = false;
  }
  await sleep(2000);
  let panelB = null;
  if (navBok) {
    try {
      panelB = await waitFor(async () => {
        const v = await panel.eval(`(() => {
          const pm = document.querySelector('.ProseMirror');
          return {
            editorMounted: !!pm,
            text: pm ? pm.innerText : '',
            figures: document.querySelectorAll('figure.screenshot-figure').length,
          };
        })()`);
        return v.editorMounted && v.figures === 0 && !/自动化测试笔记/.test(v.text)
          ? v
          : null;
      }, 12000, 500, 'panel switch to B');
    } catch {
      panelB = await panel
        .eval(`(() => {
          const pm = document.querySelector('.ProseMirror');
          return {
            editorMounted: !!pm,
            text: pm ? pm.innerText : '',
            figures: document.querySelectorAll('figure.screenshot-figure').length,
          };
        })()`)
        .catch(() => null);
    }
  }
  if (!navBok) {
    const diag = await ytPage
      .eval(`({href: location.href, body: document.body.innerText.slice(0,200)})`)
      .catch(() => null);
    check('切换到第二个视频加载独立（空）笔记', false, `导航失败（可能遇到机器人校验墙）: ${JSON.stringify(diag)}`);
  } else {
    check(
      '切换到第二个视频加载独立（空）笔记',
      !!panelB,
      panelB ? `figures=${panelB.figures}` : '面板未切换',
    );
  }

  // 13) 切回第一个视频，原笔记恢复
  await ytPage.send('Page.navigate', {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  });
  try {
    await waitFor(
      async () =>
        (await ytPage.eval(`location.href`)).includes('dQw4w9WgXcQ'),
      18000,
      500,
      'navigate back to A',
    );
  } catch {
    /* 诊断在下方统一输出 */
  }
  let panelA = null;
  try {
    panelA = await waitFor(async () => {
      const v = await panel.eval(`(() => ({
        text: document.querySelector('.ProseMirror')?.innerText ?? '',
        figures: document.querySelectorAll('figure.screenshot-figure').length,
      }))()`);
      return /自动化测试笔记/.test(v.text) && v.figures >= 1 ? v : null;
    }, 15000, 500, 'panel restore A');
  } catch {
    panelA = await panel
      .eval(`(() => ({
        text: document.querySelector('.ProseMirror')?.innerText ?? '',
        figures: document.querySelectorAll('figure.screenshot-figure').length,
      }))()`)
      .catch(() => null);
  }
  check(
    '切回第一个视频后原笔记与截图恢复（数据不串）',
    !!panelA,
    panelA ? `figures=${panelA.figures}` : '未恢复',
  );

  // 14) 截图取证（短暂把面板标签置前）
  await browser.send('Target.activateTarget', { targetId: panelTargetId });
  await sleep(700);
  await panel.shot('02-panel-restored');
  await browser.send('Target.activateTarget', { targetId: yt.id });
  await ytPage.shot('03-youtube-final');

  // 15) 汇总控制台错误
  const badEvents = [...ytPage.events, ...panel.events].filter(
    (e) =>
      e.method === 'runtime.exceptionThrown' ||
      (e.method === 'log.entryAdded' && e.params?.entry?.level === 'error'),
  );
  check('页面与面板无未捕获运行时异常', badEvents.length === 0,
    badEvents.map((e) => e.params?.exceptionDetails?.text ?? e.params?.entry?.text).join('; '));

  panel.close();
  browser.close();
  ytPage.close();

  const passed = results.filter((r) => r.ok).length;
  log(`\n==== ${passed}/${results.length} checks passed ====`);
  for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  -- ${r.detail}` : ''}`);
  writeFileSync(
    new URL('../.tmp/cdp-results.json', import.meta.url),
    JSON.stringify(results, null, 2),
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
