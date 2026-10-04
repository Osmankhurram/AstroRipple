// The launch lab: header telemetry, views, camera, legend, best view, playback, experiment controls.
import { open, step, ev, click, clickText, text, setInput, until, sleep, send, report } from './harness.mjs';

await open();
await step('countdown renders T−hh:mm:ss', async () => {
  const t = await text('.countdown-digits');
  if (!/^T−(\d+d )?\d\d:\d\d:\d\d$/.test(t)) throw new Error(t);
});
await step('window A weather popover + Show site', async () => {
  await click('.win-a .why-btn');
  await until("document.querySelector('.popover .wx-details')");
  await clickText('.popover .btn', 'Show site');
  await until("!document.querySelector('.popover')");
});
await step('window B weather popover opens and closes', async () => {
  await click('.win-b .why-btn');
  await until("document.querySelector('.popover .wx-details')");
  await click('.win-b .why-btn');
  await until("!document.querySelector('.popover')");
});
for (const [label, panes] of [['Compare', 2], ['Baseline', 1], ['Experiment', 1]]) {
  await step(`view: ${label}`, async () => {
    await clickText('[aria-label=View] button', label);
    await until(`document.querySelectorAll('.pane:not([hidden])').length===${panes}`);
  });
}
await step('camera presets', async () => {
  for (const l of ['Overview', 'Focus launch site', 'View orbital plane', 'Overview']) {
    await click(`[aria-label="${l}"]`);
    await sleep(250);
  }
});
await step('legend popover', async () => {
  await click('[aria-label=Legend]');
  await until("document.querySelector('.legend-pop .key-list')");
  await click('[aria-label=Legend]');
  await until("!document.querySelector('.legend-pop')");
});
await step('best view: card, band, sensible text, close', async () => {
  await click('.view-btn');
  await until("document.querySelector('.view-card .vc-main')");
  await until("document.querySelector('.player-band')");
  const t = await text('.view-card');
  if (!/km .* of pad/.test(t)) throw new Error(t);
  await click('[aria-label="Close best view"]');
  await until("!document.querySelector('.view-card')");
});
await step('playback: play advances, pause', async () => {
  await click('[aria-label=Play]');
  await sleep(1500);
  if ((await text('.playback-time')) === 'T+0:00:00') throw new Error('time did not advance');
  await click('[aria-label=Pause]');
});
await step('playback: speed cycles', async () => {
  const a = await text('.pbtn.speed');
  await click('.pbtn.speed');
  if ((await text('.pbtn.speed')) === a) throw new Error(a);
});
await step('playback: scrub and back to T+0', async () => {
  await setInput('.player-track input', 3600);
  await until("document.querySelector('.playback-time').textContent.includes('1:00:00')");
  await click('[aria-label="Back to T+0"]');
  await until("document.querySelector('.playback-time').textContent.includes('0:00:00')");
});
await step('timing steppers', async () => {
  await click('[aria-label="Shift 1 hour later"]');
  await until("document.querySelector('#delay').value==='60'");
  await click('[aria-label="Shift 15 minutes earlier"]');
  await until("document.querySelector('#delay').value==='45'");
});
await step('timing slider + readout', async () => {
  await setInput('#delay', -180);
  await until("document.querySelector('.stat .v.x').textContent.includes('3 h')");
});
await step('slider keyboard: Page Up = +1 h', async () => {
  await ev("document.querySelector('#delay').focus()");
  const before = Number(await ev("document.querySelector('#delay').value"));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 });
  await until(`Number(document.querySelector('#delay').value)===${before + 60}`, 3000);
});
await step('Window B and Baseline shortcuts', async () => {
  await clickText('.tick-btn', 'Window B');
  await until("document.querySelector('#delay').value==='180'");
  await clickText('.tick-btn', 'Baseline');
  await until("document.querySelector('#delay').value==='0'");
});
await step('orbit presets', async () => {
  await clickText('.orbit-key', 'Polar');
  await until("document.querySelectorAll('.orbit-key')[1].getAttribute('aria-checked')==='true'");
  await clickText('.orbit-key', 'SSO');
  await until("document.querySelectorAll('.orbit-key')[2].getAttribute('aria-checked')==='true'");
});
await step('launch site: California → weather unknown', async () => {
  await setInput('#site', 'california-coast');
  await until("document.querySelector('.deck .tag')");
  await until("[...document.querySelectorAll('.stat .wx-chip')].some(c=>c.textContent.includes('Unknown'))");
});
await step('undo and reset', async () => {
  await click('[aria-label="Undo last change"]');
  await until("document.querySelector('#site').value==='florida-coast'");
  await click('[aria-label="Reset experiment to baseline"]');
  await until("document.querySelectorAll('.orbit-key')[0].getAttribute('aria-checked')==='true' && document.querySelector('#delay').value==='0'");
});
await step('display options', async () => {
  await click('[aria-label="Display options"]');
  await until("document.querySelector('.display-options')");
  for (const l of ['Axis', 'Equator', 'Sync cameras']) {
    await click(`.display-options [aria-label="${l}"]`);
    await click(`.display-options [aria-label="${l}"]`);
  }
  await click('.display-options [aria-label="Reduced motion"]');
  await until("document.documentElement.dataset.reducedMotion==='true'");
  await click('.display-options [aria-label="Reduced motion"]');
  await until("document.documentElement.dataset.reducedMotion==='false'");
  await click('[aria-label="Display options"]');
});
await step('hover tooltip on a readout row', async () => {
  const r = JSON.parse(await ev("JSON.stringify(document.querySelector('.stat.angle').getBoundingClientRect())"));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + r.width / 2, y: r.y + r.height / 2 });
  await until("document.querySelector('.hovertip.on')", 3000);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
});
report('lab');
