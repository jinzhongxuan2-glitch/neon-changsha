/* 裁切放大：node crop.js in.png out.png x y w h [scale] */
const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';
const [IN, OUT, X, Y, W, H, S] = process.argv.slice(2);
const x = +X, y = +Y, w = +W, h = +H, s = +(S || 3);
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: Math.round(w * s), height: Math.round(h * s) } });
  const b64 = fs.readFileSync(IN).toString('base64');
  const out = await page.evaluate(([b64, x, y, w, h, s]) => new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w * s; c.height = h * s;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, x, y, w, h, 0, 0, w * s, h * s);
      res(c.toDataURL('image/png').split(',')[1]);
    };
    img.src = 'data:image/png;base64,' + b64;
  }), [b64, x, y, w, h, s]);
  fs.writeFileSync(OUT, Buffer.from(out, 'base64'));
  await browser.close();
  console.log('wrote', OUT);
})();
