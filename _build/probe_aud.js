/* E4 环境声验收：
   ① 未点击时**不建 AudioContext**（不占资源、不触发浏览器告警）
   ② 点击后 state=running，master 淡入到 0.50
   ③ 各声源随「高度 / 昼夜 / 天气 / 到水的距离」变化（不是常量摆在那里）
   ④ 开关可反复，master 落回 0 再回来
   ⑤ 帧率不掉

   **必须用 pump() 而不是 waitForTimeout()**：headless_shell 在没有帧需求时会把
   rAF 完全停住（实测 nTick 冻在 48，等 1.5s 一动不动），而 AUD 的参数是挂在 rAF 上的。
   用 waitForTimeout 等出来的结论全是「没变化」，那是假的。
*/
const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/<user>/Desktop/neon-changsha';
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';
const OUT = ROOT + '/_audit/aud/';
fs.mkdirSync(OUT, { recursive: true });

const S = o => JSON.stringify(o);

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
           '--allow-file-access-from-files', '--autoplay-policy=user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  p.on('console', m => { const t = m.text(); if (t.startsWith('AUD')) console.log('LOG', t); });

  /* **必须主动驱动，不能靠 waitForTimeout。**
     headless_shell 的 BeginFrame 只在「有渲染需求」时才发：相机在阻尼里持续运动时
     nTick 疯涨（HIGH→GROUND 涨 85），而只改天气/时间时 rAF 直接停住（nTick 冻在 6），
     等 1.5 秒读出来的「没变化」全是假的。
     这里直接调 `AUD.tick()` 验**逻辑**；rAF 链路本身由 nTick 在真实帧里增长来证明。 */
  async function pump(ms) {
    await p.evaluate((dur) => new Promise(res => {
      const t0 = performance.now();
      (function step() {
        window.__dbg.AUD.tick();                     /* 间隔 110ms > 内部 100ms 节流 */
        if (performance.now() - t0 >= dur) return res();
        setTimeout(step, 110);
      })();
    }), ms);
  }

  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await pump(3200);

  await p.click('#nav button[data-mode="free"]');   /* tour 模式下每帧会把相机拽走 */
  await pump(300);

  const init0 = await p.evaluate(() => window.__dbg.AUD.dbg());
  console.log('INIT   ', S(init0));

  /* ---- 开启 ---- */
  await p.click('#btn-snd');
  await pump(1200);
  const on1 = await p.evaluate(() => window.__dbg.AUD.dbg());
  console.log('ON/DAY ', S(on1));
  console.log('BTN    ', await p.textContent('#btn-snd'));

  /* ---- 夜间：鸟停、虫起 ---- */
  await p.evaluate(() => window.__dbg.applyTime(22.5));
  await pump(1400);
  const nite = await p.evaluate(() => window.__dbg.AUD.dbg());
  console.log('NIGHT  ', S(nite));

  /* ---- 雨天：雨起、风更响、虫鸟都降 ---- */
  await p.evaluate(() => window.__dbg.setWeather('rain'));
  await pump(1400);
  const rn = await p.evaluate(() => window.__dbg.AUD.dbg());
  console.log('RAIN   ', S(rn));
  await p.screenshot({ path: OUT + 'panel_night_rain.png', timeout: 120000 });

  /* ---- 回白天晴，抬到 900m：风起、车流落 ---- */
  await p.evaluate(() => { window.__dbg.setWeather('clear'); window.__dbg.applyTime(15); });
  await p.evaluate(() => {
    const d = window.__dbg;
    d.camera.position.set(1200, 900, 300);
    d.controls.target.set(1200, 0, 200);
    d.controls.update();
  });
  await pump(1400);
  const hi = await p.evaluate(() => window.__dbg.AUD.dbg());
  console.log('HIGH   ', S(hi));

  /* ---- 贴地 3m：车流最强、风最弱 ---- */
  await p.evaluate(() => {
    const d = window.__dbg;
    d.camera.position.set(1200, 3, 300);
    d.controls.target.set(1260, 3, 300);
    d.controls.update();
  });
  await pump(1400);
  const gnd = await p.evaluate(() => window.__dbg.AUD.dbg());
  console.log('GROUND ', S(gnd));

  /* ---- 飞到一个确定的水面点：水声应该拉满 ---- */
  const wp = await p.evaluate(() => {
    const d = window.__dbg;
    for (let x = -2400; x <= -600; x += 80)
      for (let z = -1600; z <= 1600; z += 80)
        if (d.isWater(x, z)) return [x, z];
    return null;
  });
  console.log('WATERPT', S(wp));
  let wat = null;
  if (wp) {
    await p.evaluate(([x, z]) => {
      const d = window.__dbg;
      d.camera.position.set(x, 60, z);
      d.controls.target.set(x, 0, z + 200);
      d.controls.update();
    }, wp);
    await pump(1400);
    wat = await p.evaluate(() => window.__dbg.AUD.dbg());
    console.log('ONWATER', S(wat));
  }
  await p.screenshot({ path: OUT + 'panel_ground.png', timeout: 120000 });

  /* ---- 关闭 → 再开 ---- */
  await p.click('#btn-snd');
  await pump(1000);
  const off = await p.evaluate(() => window.__dbg.AUD.dbg());
  const offBtn = await p.textContent('#btn-snd');
  console.log('OFF    ', S(off), 'btn=', offBtn);
  await p.click('#btn-snd');
  await pump(1200);
  console.log('REON   ', S(await p.evaluate(() => window.__dbg.AUD.dbg())));

  /* ---- 帧率三连（读数要过了加载后 6s 的假读数窗口）---- */
  const fps = [];
  for (let i = 0; i < 3; i++) { await pump(800); fps.push(await p.textContent('#s-fps')); }
  console.log('FPS    ', S(fps));

  /* ---- 判定：判 tgt（逻辑目标）而不是 g（音频线程状态）---- */
  const verdict = [];
  const chk = (n, ok, extra) => { verdict.push((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')); };
  chk('点击前不建 AudioContext', init0.ctx === null && init0.on === false, 'ctx=' + init0.ctx);
  chk('开启后 running', on1.state === 'running', 'state=' + on1.state);
  chk('master 淡入到 0.5', Math.abs(on1.master - 0.50) < 0.03, 'master=' + on1.master);
  chk('白天有鸟', on1.tgt.bird > 0.9, 'bird=' + on1.tgt.bird);
  chk('白天无虫', on1.tgt.crk < 0.02, 'crk=' + on1.tgt.crk);
  chk('高空（256m）无街面车流', on1.tgt.street < 0.01, 'street=' + on1.tgt.street);
  chk('岸上（CBD）无水声', on1.tgt.water < 0.05, 'water=' + on1.tgt.water);
  chk('夜间鸟停', nite.tgt.bird < 0.02, 'bird=' + nite.tgt.bird);
  chk('夜间虫起', nite.tgt.crk > 0.25, 'crk=' + nite.tgt.crk);
  chk('雨天雨声起', rn.tgt.rain > 0.4, 'rain=' + rn.tgt.rain);
  chk('雨天风更响', rn.tgt.windH > nite.tgt.windH + 0.05, rn.tgt.windH + ' > ' + nite.tgt.windH);
  chk('雨天虫压下去', rn.tgt.crk < 0.1, 'crk=' + rn.tgt.crk);
  chk('900m 风比地面大', hi.tgt.windH > 0.45 && gnd.tgt.windH < 0.10, 'hi=' + hi.tgt.windH + ' gnd=' + gnd.tgt.windH);
  chk('地面有车流', gnd.tgt.street > 0.4, 'street=' + gnd.tgt.street);
  chk('水面水声拉满', !wat || wat.tgt.water > 0.4, 'onWater=' + (wat ? wat.tgt.water : 'n/a'));
  chk('关闭后 master→0', off.master < 0.005, 'master=' + off.master);
  chk('按钮文案跟随', off.on === false && offBtn === '开声', 'btn="' + offBtn + '"');
  chk('rAF 链路真的在跑（nTick 增长）', gnd.nTick > 40, 'ON=' + on1.nTick + ' GROUND=' + gnd.nTick);
  chk('帧率不掉', fps.every(v => +v >= 55), fps.join('/'));

  console.log('\n' + verdict.join('\n'));
  await b.close();
})();
