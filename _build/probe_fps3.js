/* 稳态帧率：每个视角停 3.2s 再读一次，连读 3 次取中位数。
 * 帧率只读应用自己的 #s-fps —— 外部 rAF 轮询会和应用抢资源，出假读数。
 */
const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const ROOT = 'C:/Users/<user>/Desktop/neon-changsha';
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';

const Q = process.argv[2] || 'high';
const VIEWS = ['cbd', 'all', 'isle'];

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto('file:///' + ROOT + '/index.html?t=2&view=cbd&hour=21&q=' + Q, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction('window.__dbg && window.__dbg.SHOPS', null, { timeout: 120000 });
  await page.waitForTimeout(6000);           // 让 bloom/CSM/自适应全部稳定
  const read = () => page.evaluate(() => { const e = document.querySelector('#s-fps'); return e ? parseInt(e.textContent, 10) : -1; });
  const out = {};
  for (const v of VIEWS) {
    await page.evaluate((vv) => { const h = __dbg.HOME[vv]; __dbg.camera.position.copy(h.p); __dbg.controls.target.copy(h.t); __dbg.controls.update(); }, v);
    const s = [];
    for (let i = 0; i < 3; i++) { await page.waitForTimeout(3200); s.push(await read()); }
    s.sort((a, b) => a - b);
    out[v] = s;
  }
  console.log(Q, JSON.stringify(out));
  await browser.close();
})();
