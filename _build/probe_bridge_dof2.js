/* 桥面标线基准诊断（数值，不拍图）：
   读 BRIDGE_DECKS 里每座桥逐节点的 dof（桥走线 → 桥下自有路中线的横向偏移）。
   判据：
     · 双向分隔的桥（猴子石）底下两条路 dof 约 ±6，平均后应 ≈ 0；
     · 单路桥（福元路）dof 就是那条路的偏移，量级 3~7m；
     · 端点（落地段）dof 不应突变，否则桥头会看到一条折线。

   用法：node _build/probe_bridge_dof2.js
*/
const { chromium, ROOT, EXE } = require('./_pw');

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 600, height: 400 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&hour=13', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });

  const r = await p.evaluate(() => {
    const out = [];
    for (const d of window.__dbg.BRIDGE_DECKS) {
      if (!d.dof) { out.push({ id: d.id, err: 'no dof' }); continue; }
      const a = Array.from(d.dof);
      const n = a.length;
      const mn = Math.min(...a), mx = Math.max(...a);
      const q = [0, (n * .1) | 0, (n * .25) | 0, (n * .5) | 0, (n * .75) | 0, (n * .9) | 0, n - 1]
        .map(i => +a[i].toFixed(2));
      out.push({
        id: d.id, n, half: d.half,
        mn: +mn.toFixed(2), mx: +mx.toFixed(2), range: +(mx - mn).toFixed(2),
        /* 端点 10 个节点的均值 —— 桥头那一段偏多少，肉眼看到的错位就是这个数 */
        headAvg: +(a.slice(0, 10).reduce((s, v) => s + v, 0) / 10).toFixed(2),
        tailAvg: +(a.slice(-10).reduce((s, v) => s + v, 0) / 10).toFixed(2),
        midAvg: +(a.slice((n / 2 | 0) - 5, (n / 2 | 0) + 5).reduce((s, v) => s + v, 0) / 10).toFixed(2),
        q,
      });
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
