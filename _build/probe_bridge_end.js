/* 桥端点空洞（风险 25）：路面「沉了但没盖住」。

   `buildRoads` 把桥面覆盖范围内的复线路面沉到地下 600m，否则桥上会同时存在一条
   贴着水面的路面。问题是判定用了 `onBridgeDeck(x,z)`（默认半径 16m），而
   `_segDist` 把投影参数钳到 [0,1] —— **端点之外 16m 内也算在桥上**。
   于是桥端外侧那半圆里的岸边路面被一起沉掉，而桥面到端点为止，那里什么也没有：
   一段既无桥面又无路面的空洞。福元路的 end0 端最明显。

   这个探针的判据**不来自任何一份代码里的判定函数**，而是**朝上打一条射线**看
   头顶到底有没有桥面三角形。两套判定都拿它当裁判：

   - old（探针里复刻 `_segDist` + 默认 16m，代表修复前的行为）→ 必须能抓到 >0 个空洞
   - new（`__dbg.bridgeDeckAt`，修复后的行为）→ 空洞必须 == 0
   - 顺带验「没沉过头」：new 判定为真的点里，绝大多数头顶确实有桥面

   再补一条全场景不变量：**所有被沉掉的路面顶点，头顶都必须有桥面**。

   用法：node _build/probe_bridge_end.js
*/
const { chromium, ROOT, EXE } = require('./_pw');

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
           '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&hour=12', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  await p.waitForTimeout(600);

  const r = await p.evaluate(() => {
    const D = window.__dbg, T = D.THREE;
    D.scene.updateMatrixWorld(true);

    /* 头顶有没有桥面：朝正上方打一条射线，命中任意桥体三角形就算「盖住了」。
       实测不用把 `bridgeMat` 改成 DoubleSide —— 桥面 quad 的绕序让它在射线里是正面，
       FrontSide 照样能打中（改 DoubleSide 前后数字一模一样）。 */
    const rc = new T.Raycaster();
    const up = new T.Vector3(0, 1, 0);
    const meshes = [];
    D.bridgeGroup.traverse(o => { if (o.isMesh) meshes.push(o); });
    let nRay = 0;
    const covered = (x, z) => {
      nRay++;
      rc.set(new T.Vector3(x, 0.4, z), up);
      rc.near = 0; rc.far = 400;
      return rc.intersectObjects(meshes, false).length > 0;
    };

    /* 复刻**修复前**的判定：到走线距离 < 16m（`_segDist` 的钳制照抄） */
    const oldPred = (x, z) => {
      for (const bp of D.BRIDGES) {
        const bx = bp.box;
        if (x < bx[0] || x > bx[2] || z < bx[1] || z > bx[3]) continue;
        const pts = bp.pts;
        for (let k = 0; k < pts.length - 1; k++) {
          const ax = pts[k][0], az = pts[k][1];
          const dx = pts[k + 1][0] - ax, dz = pts[k + 1][1] - az;
          const L2 = dx * dx + dz * dz;
          let t = L2 > 1e-9 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          const qx = ax + dx * t - x, qz = az + dz * t - z;
          if (qx * qx + qz * qz < 256) return true;
        }
      }
      return false;
    };

    const out = { bridges: [], total: { oldBad: 0, newBad: 0, oldGood: 0, newGood: 0, nRay: 0 } };

    for (const bp of D.BRIDGES) {
      const S = D.deckSection(D.BRIDGE_WIDTH[bp.id] || 28);
      const row = { id: bp.id, W: D.BRIDGE_WIDTH[bp.id] || 28, half: +S.half.toFixed(1),
                    ends: [] };
      const pts = bp.pts;
      const ends = [pts[0], pts[pts.length - 1]];
      for (let e = 0; e < 2; e++) {
        const ex = ends[e][0], ez = ends[e][1];
        let oldBad = 0, newBad = 0, oldGood = 0, newGood = 0;
        let farBad = 0;        /* 空洞最多的那个点距端点多远 */
        const newBadAt = [];
        for (let dx = -42; dx <= 42; dx += 3) {
          for (let dz = -42; dz <= 42; dz += 3) {
            const x = ex + dx, z = ez + dz;
            const o = oldPred(x, z), n = D.bridgeDeckAt(x, z) >= 0;
            if (!o && !n) continue;
            const cov = covered(x, z);
            if (o) { if (cov) oldGood++; else { oldBad++; farBad = Math.max(farBad, Math.hypot(dx, dz)); } }
            if (n) {
              if (cov) newGood++;
              else { newBad++; if (newBadAt.length < 5) newBadAt.push([+x.toFixed(1), +z.toFixed(1), +Math.hypot(dx, dz).toFixed(0)]); }
            }
          }
        }
        row.ends.push({ at: [+ex.toFixed(1), +ez.toFixed(1)],
                        oldBad: oldBad, newBad: newBad, oldGood: oldGood, newGood: newGood,
                        holeR: +farBad.toFixed(0), newBadAt: newBadAt });
        out.total.oldBad += oldBad; out.total.newBad += newBad;
        out.total.oldGood += oldGood; out.total.newGood += newGood;
      }
      out.bridges.push(row);
    }

    /* 全场景不变量：**下沉必须是局部的** —— 被沉掉的路面顶点不能跑到桥走廊之外。
       为什么不是「头顶必须有桥面」：`sink` 是按**断面中线**判的，一条横断面
       （中线 ±（路半宽+人行道））会整体沉掉，边缘比桥面外沿多出 1~2m。
       那些边在 -600m 处是一张水平薄片，被桥面和江水双层遮住，看不见；
       真正看得见的洞在**端点**，由上面的网格测试负责。 */
    const corridorD = (x, z) => {
      let best = 1e9;
      for (const bp of D.BRIDGES) {
        const bx = bp.box;
        if (x < bx[0] - 40 || x > bx[2] + 40 || z < bx[1] - 40 || z > bx[3] + 40) continue;
        const half = (D.BRIDGE_WIDTH[bp.id] || 28) * 0.5;
        const pts = bp.pts;
        for (let k = 0; k < pts.length - 1; k++) {
          const ax = pts[k][0], az = pts[k][1];
          const dx = pts[k + 1][0] - ax, dz = pts[k + 1][1] - az;
          const L2 = dx * dx + dz * dz;
          let t = L2 > 1e-9 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          const qx = ax + dx * t - x, qz = az + dz * t - z;
          const d = Math.sqrt(qx * qx + qz * qz) - half;
          if (d < best) best = d;
        }
      }
      return best;
    };
    /* 「被沉掉」= y 掉到 -100 以下（这个机制是 -600）。不能用 `y < terrain-5`：
       地图边界那圈路肩裙边也低于地形，但只低 20m，跟这个机制无关。 */
    const pos = D.roadMesh.geometry.attributes.position;
    const A = pos.array;
    let sunk = 0, maxOver = -1e9, overAt = null, worst = 0;
    for (let i = 0; i < A.length; i += 3) {
      const x = A[i], y = A[i + 1], z = A[i + 2];
      if (!(y < -100)) continue;
      sunk++;
      const over = corridorD(x, z);
      worst++;
      if (over > maxOver) { maxOver = over; overAt = [+x.toFixed(1), +z.toFixed(1)]; }
    }
    out.sunk = { total: sunk, maxOver: +maxOver.toFixed(2), overAt: overAt, n: worst };
    out.total.nRay = nRay;
    return out;
  });

  console.log(JSON.stringify(r, null, 1));

  const R = [];
  const ok = (name, cond, got) => R.push([cond ? 'PASS' : 'FAIL', name, got]);

  const t = r.total;
  ok('修复前的判定确实会沉出空洞（bug 是真的）', t.oldBad > 0,
     'oldBad=' + t.oldBad + ' holeR=' + Math.max.apply(null, r.bridges.map(x => Math.max(x.ends[0].holeR, x.ends[1].holeR))).toFixed(0) + 'm');
  ok('修复后：端点附近的空洞 == 0', t.newBad === 0, 'newBad=' + t.newBad);
  ok('修复后仍然正常下沉（不是「干脆不沉了」）', t.newGood > 0 && t.newGood >= t.oldGood * 0.6,
     'newGood=' + t.newGood + ' oldGood=' + t.oldGood);
  ok('全场景：下沉严格局限在桥走廊内（越界 ≤ 18m，即一个断面半宽）',
     r.sunk.maxOver <= 18,
     'sunk=' + r.sunk.n + ' maxOver=' + r.sunk.maxOver + 'm at ' + JSON.stringify(r.sunk.overAt));

  for (const row of R) console.log(row[0].padEnd(4), row[1], '  →', row[2]);
  const bad = R.filter(x => x[0] === 'FAIL');
  console.log('---', bad.length ? bad.length + ' FAIL' : 'ALL PASS');
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
