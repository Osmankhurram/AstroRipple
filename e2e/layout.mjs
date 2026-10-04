// Responsive layout: no horizontal overflow at common widths; phone keeps the essentials reachable.
import { open, step, ev, send, until, sleep, report } from './harness.mjs';

await open();
for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 800], [1100, 800], [768, 1024], [390, 844]]) {
  await step(`${w}×${h}: no horizontal overflow`, async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 680 });
    await sleep(900);
    const r = JSON.parse(
      await ev(`JSON.stringify({sw:document.documentElement.scrollWidth, out:[...document.querySelectorAll('main *, header *')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.right>innerWidth+1||b.left<-1)&&!e.closest('.porthole')}).map(e=>e.className+'').slice(0,4)})`),
    );
    if (r.sw > w || r.out.length) throw new Error(JSON.stringify(r));
  });
}
await step('phone: Baseline/Experiment switch (no Compare) and composer visible', async () => {
  await until("document.querySelector('[aria-label=View]').children.length===2");
  await until("document.querySelector('.ask-form')");
});
await step('wide: three columns side by side', async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  const ok = await ev(`(()=>{const a=document.querySelector('.col-ask').getBoundingClientRect(),s=document.querySelector('.col-stage').getBoundingClientRect(),e=document.querySelector('.col-exp').getBoundingClientRect();return a.right<=s.left&&s.right<=e.left&&Math.abs(a.top-e.top)<2})()`);
  if (!ok) throw new Error('columns are not side by side');
});
report('layout');
