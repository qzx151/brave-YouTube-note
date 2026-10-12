// 暂停状态保持专项诊断：真实 UI 暂停后点击时间戳 chip，采样 paused/currentTime
const PORT = Number(process.env.CDP_PORT ?? 9223);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function main() {
  await sleep(500);
  const targets = await (await fetch(`${BASE}/json`)).json();
  const yt = targets.find(
    (t) => t.type === 'page' && /youtube\.com\/watch/.test(t.url),
  );
  const panelInfo = targets.find(
    (t) => t.type === 'page' && /sidepanel\.html/.test(t.url),
  );
  const ytPage = cdpSession(yt.webSocketDebuggerUrl, 'yt');
  const panel = cdpSession(panelInfo.webSocketDebuggerUrl, 'panel');
  await ytPage.ready;
  await panel.ready;

  const sample = async () =>
    ytPage.eval(`(() => {
      const v = document.querySelector('video.html5-main-video');
      return { t: Math.round(v.currentTime * 100) / 100, paused: v.paused };
    })()`);

  // 场景 A：真实 UI 暂停
  await ytPage.eval(`document.querySelector('button.ytp-play-button').click()`);
  await sleep(800);
  const uiPaused = await ytPage.eval(`document.querySelector('video.html5-main-video').paused`);
  console.log('UI 暂停后 paused =', uiPaused);
  await ytPage.eval(`document.querySelector('video.html5-main-video').currentTime = 10`);
  await sleep(300);
  await panel.eval(`document.querySelector('.ProseMirror .timestamp-chip').click()`);
  const samplesA = [];
  for (const ms of [0, 100, 300, 500, 800, 1200, 1800]) {
    await sleep(ms === 0 ? 50 : ms - (samplesA.length ? [0, 100, 300, 500, 800, 1200][samplesA.length - 1] : 0));
    samplesA.push(await sample());
  }
  console.log('UI 暂停场景采样:', JSON.stringify(samplesA));

  // 场景 B：元素 v.pause() 暂停
  await ytPage.eval(`(() => { const v = document.querySelector('video.html5-main-video'); v.pause(); })()`);
  await sleep(800);
  const elPaused = await ytPage.eval(`document.querySelector('video.html5-main-video').paused`);
  console.log('元素 pause() 后 paused =', elPaused);
  await ytPage.eval(`document.querySelector('video.html5-main-video').currentTime = 20`);
  await sleep(300);
  await panel.eval(`document.querySelector('.ProseMirror .timestamp-chip').click()`);
  const samplesB = [];
  let prev = 0;
  for (const ms of [0, 100, 300, 500, 800, 1200, 1800]) {
    await sleep(ms === 0 ? 50 : ms - prev);
    prev = ms;
    samplesB.push(await sample());
  }
  console.log('元素 pause 场景采样:', JSON.stringify(samplesB));

  ytPage.close();
  panel.close();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
