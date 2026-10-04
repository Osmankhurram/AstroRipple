// Satellite Mode: catalogs, search/select/follow, display options, screening, synthetic demo, AI chips.
import { open, step, ev, click, clickText, text, setInput, until, sleep, report } from './harness.mjs';

await open();
const ready = "document.querySelector('.sat-toolbar') && !document.querySelector('.sat-toolbar [role=status]')";
const settled = `[...document.querySelectorAll('.msg.assistant')].pop() && ![...document.querySelectorAll('.msg.assistant')].pop().querySelector('.thinking')`;

await step('turn on: toolbar, catalog, screening panel', async () => {
  await click('.sat-toggle');
  await until(ready, 60000);
  await until("document.querySelector('.prox')");
});
await step('opens on every active LEO satellite (whole globe)', async () => {
  const set = await ev("document.querySelector('#sat-cat').value");
  if (set !== 'active-leo') throw new Error('default set is ' + set);
});
await step('data source popover', async () => {
  await click('[aria-label="Satellite data source and epochs"]');
  await until("document.querySelector('.sat-source .kv')");
  await click('[aria-label="Satellite data source and epochs"]');
});
await step('search ISS → select → card → follow → clear', async () => {
  await setInput('#sat-q', 'ISS');
  await until("document.querySelector('.sat-results button') || document.querySelector('.sat-results .none')");
  if (await ev("!document.querySelector('.sat-results button')")) {
    // Offline fixture: the whole-globe set is the 250-object sample, which has no ISS.
    await setInput('#sat-cat', 'stations');
    await until(ready, 30000);
    await setInput('#sat-q', 'ISS');
  }
  await until("document.querySelector('.sat-results button')");
  await click('.sat-results button');
  await until("document.querySelector('.sat-card')");
  await clickText('.sat-card .btn', 'Follow');
  await until("[...document.querySelectorAll('.sat-card .btn')].some(b=>b.getAttribute('aria-pressed')==='true')");
  await clickText('.sat-card .btn', 'Follow');
  await click('[aria-label="Clear selection"]');
  await until("!document.querySelector('.sat-card')");
});
await step('display options: trails', async () => {
  await click('[aria-label="Satellite display options"]');
  await until("document.querySelector('.sat-pop [aria-label=Trails]')");
  for (const b of await ev("[...document.querySelectorAll('.sat-pop [aria-label=Trails] button')].map(b=>b.textContent)")) await clickText('.sat-pop [aria-label=Trails] button', b);
  await click('[aria-label="Satellite display options"]');
});
await step('time source: Scenario ↔ Now', async () => {
  await clickText('[aria-label="Time source"] button', 'Scenario');
  await until("document.querySelector('.sat-time.scenario')");
  await clickText('[aria-label="Time source"] button', 'Now');
  await until("document.querySelector('.sat-time.now')");
});
await step('active LEO sample: load + analyze', async () => {
  await setInput('#sat-cat', 'active-sample');
  await until(ready, 40000);
  await sleep(1000);
  await clickText('.prox-run .btn', 'Analyze');
  await until("document.querySelector('.prox-status.ok')", 60000);
});
await step('changing the delay marks results out of date', async () => {
  await click('[aria-label="Shift 15 minutes later"]');
  await until("document.querySelector('.prox-status.warn')", 5000);
  await click('[aria-label="Reset experiment to baseline"]');
});
await step('synthetic demo: analyze finds SYN-A', async () => {
  await setInput('#sat-cat', 'synthetic-demo');
  await until(ready, 20000);
  await clickText('[aria-label="Time source"] button', 'Scenario');
  await clickText('.prox-run .btn', 'Analyze');
  await until("document.querySelector('.prox-status.ok')", 30000);
  if (!/SYN-A/.test(await text('.prox-body'))) throw new Error('SYN-A not reported');
});
await step('watch closest plays at 1×', async () => {
  await clickText('.prox-player .btn', 'Watch closest');
  await until("document.querySelector('.pbtn.speed').textContent.trim()==='1×'");
  await sleep(800);
  await click('[aria-label=Pause]');
});
await step('approach row → focus + close-up inset', async () => {
  await click('.prox-event');
  await until("document.querySelector('.prox-event.on')");
  await until("document.querySelector('.inset')", 5000);
});
await step('comparison timing + details', async () => {
  await clickText('[aria-label="Comparison timing"] button', 'Each closest');
  await clickText('[aria-label="Comparison timing"] button', 'Same T+');
  await click('.prox details.explain summary');
  await until("document.querySelector('.prox details.explain[open] .prox-meta')");
});
await step('screening distance edit marks results stale', async () => {
  const commit = (v) => setInput('.prox-run input', v).then(() => ev("document.querySelector('.prox-run input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))"));
  await commit('50');
  await until("document.querySelector('.prox-status.warn')", 5000);
  await commit('25'); // back to the analyzed distance → current again
  await until("document.querySelector('.prox-status.ok')", 5000);
});
await step('approach markers on the transport bar', async () => {
  await clickText('.prox-run .btn', 'Analyze');
  await until("document.querySelector('.prox-status.ok')", 30000);
  await until("document.querySelector('.player-mark')", 5000);
  await click('.player-mark');
});
await step('synthetic tour runs to the end', async () => {
  await clickText('.prox-foot .btn', 'Synthetic');
  await until("document.querySelector('.syn-tour')", 5000);
  for (let i = 0; i < 10; i++) {
    if (!(await ev("[...document.querySelectorAll('.syn-tour .btn')].some(b=>/Next/.test(b.textContent))"))) break;
    await clickText('.syn-tour .btn', 'Next');
    await sleep(800);
  }
  const fin = await ev("[...document.querySelectorAll('.syn-tour .btn')].find(b=>/Finish|Exit/.test(b.textContent))?.textContent ?? null");
  if (fin) await clickText('.syn-tour .btn', fin);
});
for (const [label, cond] of [
  ['Find the ISS and follow it.', "document.querySelector('#sat-cat').value==='stations' && document.querySelector('.sat-card')"],
  ['Will it collide?', settled],
  ['Compare the original launch with a ten-minute delay.', settled],
  ['Which screened satellite comes closest to this sample ascent?', settled],
]) {
  await step(`chip: ${label}`, async () => {
    await click(`[aria-label="${label}"]`);
    await until(cond, 60000);
  });
}
await step('another launch site disables screening with a note', async () => {
  await setInput('#site', 'california-coast');
  await until("document.querySelector('.prox-note.warn')", 5000);
  await click('[aria-label="Reset experiment to baseline"]');
});
await step('compare view, then turn off', async () => {
  await clickText('[aria-label=View] button', 'Compare');
  await until("document.querySelectorAll('.pane:not([hidden])').length===2");
  await sleep(800);
  await click('.sat-toggle');
  await until("!document.querySelector('.sat-toolbar') && !document.querySelector('.prox')");
});
report('satellites');
