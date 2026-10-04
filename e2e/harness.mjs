// Minimal Chrome DevTools Protocol harness for the browser checks (no extra dependencies).
// Needs a Chromium browser started with --remote-debugging-port (see e2e/README.md).
const PORT = process.env.CDP_PORT || 9223;
export const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tab = tabs.find((t) => t.type === 'page' && !t.url.startsWith('edge:') && !t.url.startsWith('chrome:'));
if (!tab) throw new Error(`No browser page found on CDP port ${PORT}.`);
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let id = 0;
const pending = new Map();
export const logs = [];
// Known library noise: three.js deprecation notice raised inside @react-three/fiber.
const IGNORE = /THREE\.Clock|Download the React DevTools/;
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning'))
    logs.push(m.params.type.toUpperCase() + ' ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').split('\n')[0].slice(0, 240));
  const p = pending.get(m.id);
  if (p) {
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
};

export const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

export async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0] + ' :: ' + expr.slice(0, 100));
  return r.result.value;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(expr, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await ev(`Boolean(${expr})`)) return;
    } catch {}
    await sleep(120);
  }
  throw new Error('Timed out waiting for: ' + expr);
}
const q = (s) => JSON.stringify(s);
export const click = (s) => ev(`(()=>{const e=document.querySelector(${q(s)}); if(!e) throw new Error('missing '+${q(s)}); e.click(); return true})()`);
export const clickText = (sel, t) =>
  ev(`(()=>{const e=[...document.querySelectorAll(${q(sel)})].find(x=>x.textContent.trim().includes(${q(t)})); if(!e) throw new Error('missing text '+${q(t)}); e.click(); return true})()`);
export const text = (s) => ev(`document.querySelector(${q(s)})?.textContent?.trim() ?? null`);
/** Set an <input>/<select> the way React expects (native setter + input/change event). */
export const setInput = (s, v) =>
  ev(`(()=>{const e=document.querySelector(${q(s)}); if(!e) throw new Error('missing '+${q(s)}); const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${q(String(v))}); e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true})); return e.value})()`);

export async function open(w = 1440, h = 900) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 680 });
  await send('Page.navigate', { url: APP_URL });
  await until("document.querySelector('.ask-panel') && document.querySelector('canvas')", 30000);
  await sleep(1500);
}

const results = [];
/** Run one named check; console errors raised during it are reported with it. */
export async function step(name, fn) {
  const before = logs.length;
  try {
    await fn();
    const errs = logs.slice(before).filter((l) => !IGNORE.test(l) && /^(EXC|ERROR)/.test(l));
    results.push([errs.length ? 'FAIL' : 'PASS', name, errs]);
  } catch (e) {
    results.push(['FAIL', name, [String(e.message || e).slice(0, 300), ...logs.slice(before).filter((l) => !IGNORE.test(l))]]);
  }
}
export function report(suite) {
  for (const [s, n, l] of results) console.log(`${s}  ${n}${l.length ? '\n      ' + l.join('\n      ') : ''}`);
  const passed = results.filter((r) => r[0] === 'PASS').length;
  console.log(`\n${suite}: ${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
  ws.close();
}

await send('Runtime.enable');
await send('Page.enable');
