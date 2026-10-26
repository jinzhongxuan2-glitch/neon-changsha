/* 只查一件事：NIGHT 阶段 tick 到底跑没跑。
   症状：applyTime(22.5) 之后 skyUniforms.uNight 已经是 1，但 AUD 的 tgt.bird 还是 1。
   可能 A：rAF 停了（nTick 不涨）；可能 B：计算分支有问题（nTick 涨而 tgt 不变）。 */
const { chromium, ROOT, EXE } = require('./_pw');
const S = o => JSON.stringify(o);
const pick = d => ({ nTick: d.nTick, nCalc: d.nCalc, bird: d.tgt.bird, crk: d.tgt.crk, rain: d.tgt.rain });

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 760 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForTimeout(2500);
  await p.click('#nav button[data-mode="free"]');
  await p.click('#btn-snd');
  await p.waitForTimeout(1200);
  console.log('1 on    ', S(pick(await p.evaluate(() => __dbg.AUD.dbg()))));

  await p.evaluate(() => __dbg.applyTime(22.5));
  await p.waitForTimeout(1500);
  console.log('2 night ', S(pick(await p.evaluate(() => __dbg.AUD.dbg())), await p.evaluate(() => __dbg.nightNow)));

  /* 主动驱动 60 帧，看计数是否上涨 */
  await p.evaluate(() => new Promise(res => {
    let i = 0;
    const f = () => { if (++i >= 60) return res(); requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }));
  console.log('3 pump60', S(pick(await p.evaluate(() => __dbg.AUD.dbg())), await p.evaluate(() => __dbg.nightNow)));

  /* 用与 HIGH 完全相同的手法（改相机）再看 */
  await p.evaluate(() => {
    const d = __dbg;
    d.camera.position.set(1200, 900, 300);
    d.controls.target.set(1200, 0, 200);
    d.controls.update();
  });
  await p.waitForTimeout(1300);
  console.log('4 cam   ', S(pick(await p.evaluate(() => __dbg.AUD.dbg()))));

  await b.close();
})();
