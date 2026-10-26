/* 移动端验收（390×844，iPhone 14 逻辑分辨率）
   ① 打开就是「看城市」：控制面板默认收起在视口外，右下角只有一个 46px 圆钮
   ② 点圆钮 → 面板从底部升起，不遮小地图，chip 高度够手指点
   ③ 面板里改天气真的生效
   ④ 点画面 → 面板收起；点建筑 → 卡片出现时面板和圆钮都让位
   ⑤ 桌面端行为完全不变：#ctrl 隐藏、#panel 常驻右下
*/
const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');
const OUT = ROOT + '/_audit/mm/';
fs.mkdirSync(OUT, { recursive: true });
const S = o => JSON.stringify(o);

const rect = id => {
  const e = document.getElementById(id);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  const cs = getComputedStyle(e);
  return { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0),
           disp: cs.display, vis: cs.visibility, pe: cs.pointerEvents };
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });

  const verdict = [];
  const chk = (n, ok, extra) => verdict.push((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : ''));

  /* ================= 移动端 ================= */
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForFunction('window.__dbg.MM && window.__dbg.MM.built', null, { timeout: 60000 })
    .catch(() => console.log('MM.built TIMEOUT'));
  await p.waitForTimeout(1400);

  const closed = await p.evaluate((rf) => {
    const R = new Function('return ' + rf)();
    return { panel: R('panel'), ctrl: R('ctrl'), mm: R('mm'), nav: R('nav'),
             body: document.body.className, W: innerWidth, H: innerHeight };
  }, rect.toString());
  console.log('CLOSED ', S(closed));
  await p.screenshot({ path: OUT + 'm_closed.png', timeout: 120000 });

  chk('面板默认收起（在视口下方）', closed.panel.y >= closed.H, 'panel.y=' + closed.panel.y + ' H=' + closed.H);
  chk('面板收起时不接收点击', closed.panel.pe === 'none', 'pe=' + closed.panel.pe);
  chk('圆钮可见且在右下', closed.ctrl.disp === 'flex' && closed.ctrl.x > closed.W - 80 && closed.ctrl.y > closed.H - 90,
      S([closed.ctrl.x, closed.ctrl.y, closed.ctrl.w, closed.ctrl.h]));

  /* ---- 展开 ---- */
  await p.click('#ctrl');
  await p.waitForTimeout(620);
  const open = await p.evaluate((rf) => {
    const R = new Function('return ' + rf)();
    const chips = [...document.querySelectorAll('#panel .chip')].map(e => {
      const r = e.getBoundingClientRect();
      return { t: e.textContent.trim().slice(0, 4), h: +r.height.toFixed(0), w: +r.width.toFixed(0) };
    });
    return { panel: R('panel'), ctrl: R('ctrl'), mm: R('mm'), nav: R('nav'), hourwrap: R('hourwrap'),
             body: document.body.className, chips, W: innerWidth, H: innerHeight,
             minChipH: Math.min(...chips.map(c => c.h)),
             scrollable: document.getElementById('panel').scrollHeight > document.getElementById('panel').clientHeight + 2 };
  }, rect.toString());
  console.log('OPEN   ', S({ panel: open.panel, ctrl: open.ctrl, nav: open.nav, minChipH: open.minChipH, scrollable: open.scrollable }));
  await p.screenshot({ path: OUT + 'm_open.png', timeout: 120000 });

  chk('点圆钮后面板升起', open.body.includes('ctrl') && open.panel.y < open.H && open.panel.y > open.H * 0.3,
      'panel.y=' + open.panel.y);
  chk('面板接住点击', open.panel.pe === 'auto', 'pe=' + open.panel.pe);
  chk('面板不遮挡小地图', open.mm.y + open.mm.h < open.panel.y, 'mm底=' + (open.mm.y + open.mm.h) + ' panel顶=' + open.panel.y);
  chk('展开时导航让位', open.nav.pe === 'none' || open.nav.vis === 'hidden' || +open.nav.h === 0, 'nav.pe=' + open.nav.pe);
  chk('chip 高度够手指点（≥34）', open.minChipH >= 34, 'min=' + open.minChipH + ' n=' + open.chips.length);
  chk('TIME 组完整在屏内', open.hourwrap.y + open.hourwrap.h <= open.H,
      '底=' + (open.hourwrap.y + open.hourwrap.h) + ' H=' + open.H);
  chk('展开时圆钮让开（不压 LOW）', open.ctrl.pe === 'none', 'pe=' + open.ctrl.pe);
  chk('面板内容不溢出（不需要滚动）', !open.scrollable, 'scrollable=' + open.scrollable);

  /* ---- 面板里改天气 ---- */
  const wx0 = await p.evaluate(() => __dbg.wxNow);
  const rainBtn = await p.$('#panel .chip[data-wx="rain"]');
  const rb = await rainBtn.boundingBox();
  if (rb) await p.mouse.click(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await p.waitForTimeout(700);
  const wx1 = await p.evaluate(() => __dbg.wxNow);
  console.log('WX     ', wx0, '->', wx1);
  chk('面板里点「雨」真的切天气', wx1 === 'rain', wx0 + '→' + wx1);

  /* ---- 点画面收起 ---- */
  await p.mouse.click(195, 300);
  await p.waitForTimeout(600);
  const afterTap = await p.evaluate((rf) => {
    const R = new Function('return ' + rf)();
    return { panel: R('panel'), body: document.body.className, W: innerWidth, H: innerHeight,
             scrollable: document.getElementById('panel').scrollHeight > document.getElementById('panel').clientHeight + 2 };
  }, rect.toString());
  console.log('TAPPED ', S(afterTap));
  /* 不能判 transform 是否到位：CSS transition 也要 rAF 推，headless 空闲时会把面板
     冻在半路上（读到 y=664 这种中间值）。判「类名已移除 + 不再接收点击」才是状态本身。 */
  chk('点画面收起面板', !afterTap.body.includes('ctrl') && afterTap.panel.pe === 'none',
      'body="' + afterTap.body + '" pe=' + afterTap.panel.pe + ' y=' + afterTap.panel.y);

  /* ---- 点建筑：卡片出现，面板和圆钮让位 ---- */
  const hit = await p.evaluate(() => {
    const d = window.__dbg, W = innerWidth, H = innerHeight;
    for (let gy = 0.30; gy < 0.80; gy += 0.04)
      for (let gx = 0.20; gx < 0.85; gx += 0.04) {
        const h = d.PICK.at(W * gx, H * gy);
        if (h && h.b.h > 30) { d.PICK.open(h); return { h: +h.b.h.toFixed(0), sx: +(W * gx).toFixed(0), sy: +(H * gy).toFixed(0) }; }
      }
    return null;
  });
  await p.waitForTimeout(900);
  const card = await p.evaluate((rf) => {
    const R = new Function('return ' + rf)();
    return { inspect: R('inspect'), ctrl: R('ctrl'), panel: R('panel'), body: document.body.className };
  }, rect.toString());
  console.log('CARD   ', S(hit), S(card));
  await p.screenshot({ path: OUT + 'm_card.png', timeout: 120000 });

  chk('卡片贴底全宽', card.inspect.w >= 360 && card.inspect.y > 600, 'w=' + card.inspect.w + ' y=' + card.inspect.y);
  chk('卡片出现时圆钮隐藏', card.ctrl.pe === 'none' || card.ctrl.disp === 'none' || card.body.includes('insp'),
      'body=' + card.body);

  /* ---- 横屏 844×390 也不能崩 ---- */
  await p.setViewportSize({ width: 844, height: 390 });
  await p.evaluate(() => { __dbg.PICK.close(); document.body.className = ''; });
  await p.waitForTimeout(700);
  const land = await p.evaluate((rf) => {
    const R = new Function('return ' + rf)();
    return { panel: R('panel'), ctrl: R('ctrl'), mm: R('mm'), W: innerWidth, H: innerHeight };
  }, rect.toString());
  console.log('LAND   ', S(land));
  await p.screenshot({ path: OUT + 'm_land.png', timeout: 120000 });
  chk('横屏圆钮仍可用', land.ctrl.disp === 'flex', 'disp=' + land.ctrl.disp);

  /* ================= 桌面端不受影响 ================= */
  const d = await b.newPage({ viewport: { width: 1400, height: 800 } });
  d.on('pageerror', e => console.log('ERR', e.message));
  await d.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  await d.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await d.waitForTimeout(1600);
  const desk = await d.evaluate((rf) => {
    const R = new Function('return ' + rf)();
    return { panel: R('panel'), ctrl: R('ctrl'), W: innerWidth, H: innerHeight };
  }, rect.toString());
  console.log('DESK   ', S(desk));
  await d.screenshot({ path: OUT + 'm_desk.png', timeout: 120000 });

  chk('桌面端隐藏圆钮', desk.ctrl.disp === 'none', 'disp=' + desk.ctrl.disp);
  chk('桌面端面板常驻右下', desk.panel.x > 1000 && desk.panel.y < 500, S([desk.panel.x, desk.panel.y, desk.panel.w, desk.panel.h]));

  console.log('\n' + verdict.join('\n'));
  await b.close();
})();
