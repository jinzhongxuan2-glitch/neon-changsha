/* 两张 PNG 的像素对比（纯浏览器 canvas，无第三方依赖）
 *
 *   node diff.js a.png b.png
 *   node diff.js a.png b.png _audit/heat/night_cbd.png
 *   node diff.js a.png b.png --max-mean 0.35 --max-pct8 0.05
 *
 * 输出：mean（0-255 的平均绝对差）、pct2 / pct8（差值超过 2 / 8 的像素占比）
 * 退出码：0 通过；1 超过阈值；2 尺寸不一致
 */
const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');
const path = require('path');


const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? Number(argv[i + 1]) : d; };
const files = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

if (files.length < 2) {
  console.error('用法: node diff.js a.png b.png [heat.png] [--max-mean 0.35] [--max-pct8 0.05]');
  process.exit(64);
}

const [A, B, HEAT] = files;
const MAX_MEAN = flag('max-mean', NaN);
const MAX_PCT8 = flag('max-pct8', NaN);

(async () => {
  const b64 = (p) => fs.readFileSync(p).toString('base64');
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage();

  const res = await page.evaluate(async ({ a, b }) => {
    const load = (src) => new Promise((ok, no) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => no(new Error('decode failed'));
      img.src = 'data:image/png;base64,' + src;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) {
      return { error: 'size ' + ia.width + 'x' + ia.height + ' vs ' + ib.width + 'x' + ib.height };
    }
    const w = ia.width, h = ia.height;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(ia, 0, 0);
    const da = cx.getImageData(0, 0, w, h).data;
    cx.clearRect(0, 0, w, h);
    cx.drawImage(ib, 0, 0);
    const db = cx.getImageData(0, 0, w, h).data;

    const hist = new Uint32Array(256);
    const heat = cx.createImageData(w, h);
    let sum = 0, max = 0, over2 = 0, over8 = 0;
    const n = w * h;
    for (let i = 0, p = 0; i < da.length; i += 4, p++) {
      const dr = Math.abs(da[i] - db[i]);
      const dg = Math.abs(da[i + 1] - db[i + 1]);
      const dbl = Math.abs(da[i + 2] - db[i + 2]);
      const v = (dr + dg + dbl) / 3;
      sum += v; if (v > max) max = v;
      if (v > 2) over2++;
      if (v > 8) over8++;
      hist[Math.min(255, v | 0)]++;
      const k = Math.min(255, v * 6) | 0;
      heat.data[i] = k;
      heat.data[i + 1] = (k * 0.30) | 0;
      heat.data[i + 2] = 0;
      heat.data[i + 3] = 255;
    }
    cx.putImageData(heat, 0, 0);
    let p95 = 0, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.95) { p95 = i; break; } }
    return {
      w, h,
      mean: +(sum / n).toFixed(4),
      max,
      p95,
      pct2: +(over2 / n * 100).toFixed(4),
      pct8: +(over8 / n * 100).toFixed(4),
      heat: cv.toDataURL('image/png').split(',')[1],
    };
  }, { a: b64(A), b: b64(B) });

  await browser.close();

  if (res.error) { console.error(res.error); process.exit(2); }

  if (HEAT) {
    fs.mkdirSync(path.dirname(HEAT), { recursive: true });
    fs.writeFileSync(HEAT, Buffer.from(res.heat, 'base64'));
  }

  const line = {
    a: path.basename(A), b: path.basename(B),
    size: res.w + 'x' + res.h,
    mean: res.mean, p95: res.p95, max: res.max, pct2: res.pct2, pct8: res.pct8,
  };
  console.log(JSON.stringify(line));

  let bad = false;
  if (Number.isFinite(MAX_MEAN) && res.mean > MAX_MEAN) bad = true;
  if (Number.isFinite(MAX_PCT8) && res.pct8 > MAX_PCT8) bad = true;
  process.exit(bad ? 1 : 0);
})();
