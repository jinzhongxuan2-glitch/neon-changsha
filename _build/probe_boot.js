/* 读分阶段打点，输出构建耗时分解 */
const { chromium, ROOT, EXE } = require('./_pw');

(async () => {
  const b = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files']
  });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await p.addInitScript(() => {
    window.__lt = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lt.push({ d: Math.round(e.duration), s: Math.round(e.startTime) });
      }).observe({ entryTypes: ['longtask'] });
    } catch (e) {}
  });

  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=21',
    { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForTimeout(800);

  const r = await p.evaluate(() => {
    const marks = performance.getEntriesByType('mark')
      .filter(m => m.name.startsWith('B:'))
      .map(m => ({ n: m.name.slice(2), t: Math.round(m.startTime) }))
      .sort((a, b) => a.t - b.t);
    const lt = (window.__lt || []).slice().sort((a, b) => b.d - a.d).slice(0, 6);
    // 相邻阶段差值
    const segs = [];
    for (let i = 1; i < marks.length; i++) segs.push(marks[i].n + ' +' + (marks[i].t - marks[i - 1].t));
    return { marks, segs, lt, nav: Math.round((performance.getEntriesByType('navigation')[0] || {}).responseEnd || 0) };
  });

  console.log('NAV_RESPONSE_END', r.nav);
  console.log('MARKS', JSON.stringify(r.marks));
  console.log('SEGMENTS', JSON.stringify(r.segs));
  console.log('LONG_TASKS', JSON.stringify(r.lt));
  await b.close();
})();
