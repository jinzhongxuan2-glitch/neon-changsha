/* isle 视角掉帧定位：小地图 draw 是不是元凶。A/B 直接覆盖 MM.draw 成空函数。 */
const { chromium, ROOT, EXE } = require('./_pw');

const readFps = async (p, n = 3) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    await p.waitForTimeout(900);
    out.push(await p.evaluate(() => +document.getElementById('s-fps').textContent));
  }
  return out;
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=isle&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForTimeout(6000);      /* #s-fps 在加载后 6s 内是假读数 */

  console.log('A_MM_ON   ', JSON.stringify(await readFps(p)));

  await p.evaluate(() => { window.__dbg.MM.draw = () => {}; });
  console.log('B_MM_OFF  ', JSON.stringify(await readFps(p)));

  await p.evaluate(() => document.getElementById('mm').style.display = 'none');
  console.log('C_HIDDEN  ', JSON.stringify(await readFps(p)));

  await b.close();
})();
