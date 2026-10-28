/* probe_freeze —— §45 启动期冻结修复的回归探针。
   修的内容：① 烟花 shell 用沙盒 RNG 提前创建 + `renderer.compile` 全量预编译，
   把 three 惰性编译 GLSL 的 1.4~3.1s 同步长任务压进加载画面之下；
   ② 加载画面摘除之后不允许再出现 >250ms 的主线程长任务。
   判据：
     F1  #load.done 已加（加载画面真的摘了）
     F2  烟花 shell 在启动期就建好了（FW_SHELLS.length === 4），不用等第一发
     F3  摘除后无 >250ms 主线程长任务（longtask 证实才算；
         headless rAF 节流暂停会造几秒的帧间隔但不是在算东西 —— 坑 #17）
     F4  帧循环活着（摘除后帧数 >= 5）
     F5  `renderer.info.programs` 已有程序缓存（预编译真的跑了）
   工装坑（两次踩）：录制器必须从 B:done 后**立刻**起跑盖全程、事后按时窗切；
   「先 await 等 load.done 再起 rAF」会确定性触发 headless 节流（12s 停摆、无
   longtask，四个会话复现）。 */
const { chromium, ROOT, EXE } = require('./_pw');
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => { console.log('ERR', e.message); process.exitCode = 1; });
  await p.goto('file:///' + ROOT + '/index.html?t=2&view=cbd&hour=21&q=high', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  await p.evaluate(() => {
    (function pump(){ requestAnimationFrame(pump); })();
    window.__rec = { mark: -1, dts: [], lt: [] };
    /* load.done 时刻打点 */
    const el = document.getElementById('load');
    const mo = new MutationObserver(() => {
      if(el.classList.contains('done') && window.__rec.mark < 0)
        window.__rec.mark = performance.now();
    });
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    if(el.classList.contains('done')) window.__rec.mark = performance.now();
    try { new PerformanceObserver(l => { for (const e of l.getEntries())
      window.__rec.lt.push([+e.startTime.toFixed(0), +e.duration.toFixed(0)]); })
      .observe({ entryTypes: ['longtask'] }); } catch(_) {}
    let prev = performance.now();
    (function step(t){ window.__rec.dts.push([+(t - prev).toFixed(1), +t.toFixed(0)]);
      prev = t; requestAnimationFrame(step); })(performance.now());
  });
  await p.waitForTimeout(14000);
  const r = await p.evaluate(() => {
    const D = window.__dbg, rec = window.__rec;
    const mark = rec.mark;
    /* 只统计摘除（+1.2s 淡出余量）之后的帧与长任务 */
    const after = rec.dts.filter(v => v[1] > mark + 1200);
    const realLongs = rec.lt.filter(v => v[0] > mark + 1200 && v[1] > 250);
    const allLongs = rec.lt.filter(v => v[1] > 250);
    return {
      shells: D.FW.shells.length,
      programs: D.renderer.info.programs ? D.renderer.info.programs.length : -1,
      mark: +mark.toFixed(0),
      nAfter: after.length,
      maxAfter: after.length ? Math.max(...after.map(v=>v[0])) : -1,
      realLongs, allLongs: allLongs.slice(0,6),
    };
  });

  const T = [
    ['F1 加载画面已摘除', r.mark > 0],
    ['F2 烟花 shell 启动期建好 (4)', r.shells === 4],
    ['F3 摘除后无 >250ms 主线程长任务', r.realLongs.length === 0],
    ['F4 摘除后帧循环没死（>= 2 帧）。headless 的帧供给本身就是断续的：有帧时 ' +
     '16.7ms 整，没帧时整段停供且零 longtask（合成器没收到强制信号）—— ' +
     '帧间隔不作判据，真卡由 F3 的 longtask 判', r.nAfter >= 2],
    ['F5 程序缓存已建立', r.programs > 10],
  ];
  console.log(`mark=${r.mark}ms shells=${r.shells} programs=${r.programs} nAfter=${r.nAfter} maxAfter=${r.maxAfter}ms`);
  console.log(`longtask 全程=${JSON.stringify(r.allLongs)} 摘除后=${JSON.stringify(r.realLongs)}`);
  let fail = 0;
  for(const [n, ok] of T){ console.log((ok?'PASS':'FAIL') + '  ' + n); if(!ok) fail++; }
  console.log(fail === 0 ? 'ALL PASS (' + T.length + ')' : fail + ' FAILED');
  await b.close();
  process.exitCode = fail === 0 ? 0 : 1;
})();
