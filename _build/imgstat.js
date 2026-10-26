/* 单图统计（纯浏览器 canvas，无第三方依赖）
 *   node imgstat.js a.png [b.png ...]
 * 输出：每行一个 JSON：{"file":..., "min":..,"max":..,"mean":..,"flat":true|false}
 * flat=true 表示这张图像是坏的（全黑或一整片平），截图失败时常见。
 */
const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');


(async () => {
  const files = process.argv.slice(2).filter(Boolean);
  if (!files.length) { console.error('usage: imgstat.js <png...>'); process.exit(2); }
  const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 200, height: 200 } });
  await p.goto('about:blank');
  for (const f of files) {
    const data = fs.readFileSync(f).toString('base64');
    const st = await p.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const n = 64;
      const cv = document.createElement('canvas'); cv.width = n; cv.height = n;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, n, n);
      const d = cx.getImageData(0, 0, n, n).data;
      let mn = 255, mx = 0, sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        if (g < mn) mn = g;
        if (g > mx) mx = g;
        sum += g;
      }
      return { min: +mn.toFixed(1), max: +mx.toFixed(1), mean: +(sum / (n * n)).toFixed(1) };
    }, data);
    const flat = st.max < 8 || (st.max - st.min) < 8;
    console.log(JSON.stringify({ file: f.replace(/\\/g, '/'), ...st, flat }));
  }
  await b.close();
})();
