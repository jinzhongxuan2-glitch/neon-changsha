/* 只看 UI：2x DPR 截 SOUND 分组，确认「开声/静音」两态都正常、没有被挤出面板 */
const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const ROOT = 'C:/Users/<user>/Desktop/neon-changsha';
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';
const OUT = ROOT + '/_audit/aud/';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForTimeout(3000);

  const box = await p.locator('#panel').boundingBox();
  console.log('PANEL', JSON.stringify(box));

  await p.screenshot({ path: OUT + 'ui_off.png', clip: box, timeout: 120000 });
  await p.click('#btn-snd');
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + 'ui_on.png', clip: box, timeout: 120000 });

  const m = await p.evaluate(() => {
    const g = [...document.querySelectorAll('#panel .grp')].map(d => {
      const r = d.getBoundingClientRect();
      return { lbl: d.querySelector('.lbl').textContent, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const s = document.getElementById('btn-snd').getBoundingClientRect();
    const pn = document.getElementById('panel').getBoundingClientRect();
    return { grps: g, snd: { x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.width), h: Math.round(s.height) },
             panel: { x: Math.round(pn.x), y: Math.round(pn.y), w: Math.round(pn.width), h: Math.round(pn.height) },
             sndRect: getComputedStyle(document.getElementById('btn-snd')).color };
  });
  console.log('GRPS ', JSON.stringify(m, null, 0));

  /* 移动端 390 宽：SOUND 组会不会把面板撑破 */
  const p2 = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p2.goto('file:///' + ROOT + '/index.html?t=2&q=mid&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p2.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p2.waitForTimeout(3000);
  const mp = await p2.evaluate(() => {
    const r = document.getElementById('panel').getBoundingClientRect();
    const s = document.getElementById('btn-snd').getBoundingClientRect();
    const mm = document.getElementById('mm').getBoundingClientRect();
    return { panel: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
             snd: [Math.round(s.x), Math.round(s.y), Math.round(s.width), Math.round(s.height)],
             mm: [Math.round(mm.x), Math.round(mm.y), Math.round(mm.width), Math.round(mm.height)],
             overflowY: document.documentElement.scrollHeight > innerHeight };
  });
  console.log('MOBILE', JSON.stringify(mp));
  await p2.screenshot({ path: OUT + 'ui_mobile.png', timeout: 120000 });

  await b.close();
})();
