const BASE = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cdpSession(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error(label))); });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  });
  return { ready, send: (method, params={}) => { const i=++id; ws.send(JSON.stringify({id:i,method,params})); return new Promise((res,rej)=>pending.set(i,{resolve:res,reject:rej})); },
    async eval(e){ const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true,userGesture:true}); if(r.exceptionDetails) return {__err:r.exceptionDetails.exception?.description??r.exceptionDetails.text}; return r.result.value; } };
}
const targets = await (await fetch(`${BASE}/json`)).json();
const swInfo = targets.find((t) => t.type === 'service_worker' && /background\.js$/.test(t.url));
const sw = cdpSession(swInfo.webSocketDebuggerUrl, 'sw');
await sw.ready; await sw.send('Runtime.enable'); await sleep(200);

const all = await sw.eval(`(async()=>{ const p = await chrome.permissions.getAll(); return {perms:p.permissions, hosts:p.origins}; })()`);
console.log('getAll:', JSON.stringify(all));

const contains = await sw.eval(`(async()=>{ try { return await chrome.permissions.contains({origins:['https://www.youtube.com/*']}); } catch(e){ return String(e); } })()`);
console.log('contains youtube host:', JSON.stringify(contains));

// 尝试在 SW 中用 activeTab 判定 + 不带 windowId 调用
const cap2 = await sw.eval(`(async()=>{ try { const u = await chrome.tabs.captureVisibleTab(undefined,{format:'png'}); return {ok:true,len:u.length}; } catch(e){ return {ok:false,err:String(e.message)}; } })()`);
console.log('capture no-windowId:', JSON.stringify(cap2));
process.exit(0);
