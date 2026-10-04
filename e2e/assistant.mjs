// Ask panel (scripted mode without an API key), guided tour, guide sheet, reset, real-world feed.
import { open, step, ev, click, clickText, text, setInput, until, sleep, report } from './harness.mjs';

await open();
const lastLead = () => ev(`[...document.querySelectorAll('.msg.assistant .lead')].pop()?.textContent ?? ''`);
const settled = `[...document.querySelectorAll('.msg.assistant')].pop() && ![...document.querySelectorAll('.msg.assistant')].pop().querySelector('.thinking')`;
async function ask(question) {
  await setInput('#ask', question);
  await click('.ask-form button[type=submit]');
  await until(`[...document.querySelectorAll('.msg.user')].pop()?.textContent.includes(${JSON.stringify(question.slice(0, 20))})`);
  await until(settled, 10000);
}

await step('mode tag resolves (Scripted or Live AI)', async () => {
  await until("document.querySelector('.mode-tag') && !document.querySelector('.mode-tag').textContent.includes('Checking')");
  if (!/Scripted|Live AI/.test(await text('.mode-tag'))) throw new Error(await text('.mode-tag'));
});
await step('chip: 2 h later moves the experiment', async () => {
  await click('[aria-label="What if we launch two hours later?"]');
  await until("document.querySelector('#delay').value==='120'");
  await until("document.querySelector('.msg.assistant .lead')", 10000);
});
await step('action chip highlights its manual control', async () => {
  await click('.receipt');
  await until("document.querySelector('.pulse')", 3000);
});
await step('chip: polar orbit', async () => {
  await click('[aria-label="Show me a polar orbit."]');
  await until("document.querySelectorAll('.orbit-key')[1].getAttribute('aria-checked')==='true'");
});
await step('chip: why yellow', async () => {
  await click('[aria-label="Why is the weather yellow?"]');
  await until(settled, 10000);
});
await step('chip: window A vs B', async () => {
  await click('[aria-label="Compare the two supplied windows."]');
  await until("document.querySelector('#delay').value==='180'", 10000);
});
const typed = [
  ['what if we launch 3 hours earlier?', "document.querySelector('#delay').value==='-180'"],
  ['launch from French Guiana', "document.querySelector('#site').value==='french-guiana'"],
  ['reset the experiment', "document.querySelector('#delay').value==='0' && document.querySelector('#site').value==='florida-coast'"],
  ['where should I watch from?', "document.querySelector('.view-card')"],
  ['show me an SSO orbit', "document.querySelectorAll('.orbit-key')[2].getAttribute('aria-checked')==='true'"],
  ['one more hour', "document.querySelector('#delay').value==='60'"],
  ['how much fuel does a delay cost?', 'true'],
  ['asdfgh', 'true'],
];
for (const [question, cond] of typed) {
  await step(`typed: "${question}"`, async () => {
    await ask(question);
    await until(cond, 10000);
    const lead = await lastLead();
    if (!lead || lead.length < 8 || / g\.$/.test(lead)) throw new Error('bad answer: ' + lead);
  });
}
await step('reset all asks for confirmation, then clears', async () => {
  await clickText('.topbar-actions .btn', 'Reset all');
  await until("[...document.querySelectorAll('.topbar-actions .btn')].some(b=>b.textContent.includes('Confirm'))");
  await clickText('.topbar-actions .btn', 'Confirm');
  await until("document.querySelectorAll('.msg.assistant').length===0 && document.querySelector('#delay').value==='0'");
});
await step('guide sheet opens, expands, closes', async () => {
  await click('[aria-label="Guide: how it works"]');
  await until("document.querySelector('dialog.sheet').open");
  await ev("document.querySelectorAll('dialog.sheet details').forEach(d=>d.open=true)");
  await click('dialog.sheet [aria-label=Close]');
  await until("!document.querySelector('dialog.sheet').open");
});
await step('guided tour runs to the end', async () => {
  await click('[aria-label="Start guided tour"]');
  await until("document.querySelector('.tour-count')");
  await click('.tour-actions button'); // pause auto-advance
  for (let i = 0; i < 7; i++) {
    await click('.tour-actions .primary');
    await sleep(350);
  }
  await until("document.querySelector('[aria-label=\"Finish tour\"]')");
  await click('[aria-label="Finish tour"]');
  await until("!document.querySelector('.tour')");
});
await step('real-world feed loads (or reports unavailable)', async () => {
  if (!(await ev("!!document.querySelector('.livefeed .btn')"))) return; // turned off on this server
  await click('.livefeed .btn');
  await until("document.querySelector('.livefeed-grid') || document.querySelector('.livefeed .muted')", 30000);
});
report('assistant');
