/* 截图验收：图不是空的 / 尺寸对 / 水印在右下角 / UI 确实被藏掉 / 关闭与重拍正常 / 分享链接能还原机位 */
const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/<user>/Desktop/neon-changsha';
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';
const OUT = ROOT + '/_audit/shot/';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  p.on('console', m => { const t = m.text(); if (t.startsWith('SHOT') || t.startsWith('SHARE')) console.log('LOG', t); });
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForTimeout(2500);

  await p.screenshot({ path: OUT + 'ui_before.png', timeout: 120000 });

  /* 点「拍照」 */
  await p.click('#btn-shot');
  await p.waitForFunction("document.getElementById('shotbox').classList.contains('on')", null, { timeout: 30000 })
    .catch(() => console.log('SHOTBOARD TIMEOUT'));
  await p.waitForTimeout(500);

  const r = await p.evaluate(async () => {
    const img = document.getElementById('shot-img');
    const dl = document.getElementById('shot-dl');
    const box = document.getElementById('shotbox');
    const meta = document.getElementById('shot-meta').textContent;
    /* 把 dataURL 画进一个临时 canvas 采样，确认不是全黑/全透明 */
    let stat = null;
    try {
      const c = document.createElement('canvas');
      c.width = 280; c.height = 160;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, dark = 0, n = d.length / 4, alphaZero = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) alphaZero++;
        const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        sum += l; if (l < 6) dark++;
      }
      stat = { avgLum: +(sum / n).toFixed(1), darkPct: +(dark / n * 100).toFixed(1),
               alphaZeroPct: +(alphaZero / n * 100).toFixed(1) };
    } catch (e) { stat = { err: String(e) }; }
    return {
      on: box.classList.contains('on'),
      imgW: img.naturalWidth, imgH: img.naturalHeight,
      srcLen: (img.src || '').length, isPNG: (img.src || '').startsWith('data:image/png'),
      download: dl.getAttribute('download'),
      meta, stat,
      uiHiddenNow: [].filter.call(document.querySelectorAll('.ui'), e => getComputedStyle(e).display === 'none').length
        + '/' + document.querySelectorAll('.ui').length,
    };
  });
  console.log('SHOT', JSON.stringify(r, null, 1));

  /* 把预览里的图存出来 */
  const dataUrl = await p.evaluate(() => document.getElementById('shot-img').src);
  fs.writeFileSync(OUT + 'shot.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
  await p.screenshot({ path: OUT + 'preview.png', timeout: 120000 });

  /* 关闭 */
  await p.click('#shot-x');
  await p.waitForTimeout(420);
  const closed = await p.evaluate(() => document.getElementById('shotbox').classList.contains('on'));
  console.log('CLOSE', closed ? 'STILL OPEN (bad)' : 'ok');

  /* UI 恢复了吗 */
  const restored = await p.evaluate(() => {
    const panel = document.getElementById('panel');
    const mm = document.getElementById('mm');
    return { panel: getComputedStyle(panel).display, mm: getComputedStyle(mm).display };
  });
  console.log('RESTORE', JSON.stringify(restored));

  /* 分享链接：改机位 -> 生成 URL -> 用新页面打开 -> 机位应该一致 */
  const link = await p.evaluate(() => {
    const d = window.__dbg;
    d.camera.position.set(512, 388, -744);
    d.controls.target.set(-120, 96, -300);
    d.controls.update();
    return d.SHOT.shareURL();
  });
  console.log('SHARE_URL', link.replace(/^.*\?/, '?'));

  const p2 = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p2.on('pageerror', e => console.log('ERR2', e.message));
  await p2.goto(link, { waitUntil: 'load', timeout: 240000 });
  await p2.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p2.waitForTimeout(1200);
  const back = await p2.evaluate(() => ({
    cam: window.__dbg.camera.position.toArray().map(v => +v.toFixed(1)),
    tgt: window.__dbg.controls.target.toArray().map(v => +v.toFixed(1)),
    hour: document.getElementById('hourv') ? document.getElementById('hourv').textContent : null,
  }));
  console.log('RESTORED_CAM', JSON.stringify(back));
  await p2.close();

  await b.close();
})();
