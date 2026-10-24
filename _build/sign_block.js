/* ============================================================
   4c. 临街招牌（阶段 3 · 街道层）
   招牌比任何贴图都更能把「中国商业街」立起来：低层临街楼在 4~8m 高度挂灯箱，
   白天是彩色板，夜里自发光。完全不依赖贴图，纯几何 + 顶点色。
   ============================================================ */
const SIGN_PAL = ['#c8342a', '#a8241c', '#1f5fbf', '#e0a520', '#1f8a4a', '#d9d3c4', '#b02a6a', '#c8342a', '#1f5fbf'];

const signUniforms = {
  uNight:{value:0}, uFogColor:{value:PAL.fog.clone()}, uFogDensity:{value:FOG_D},
};
const signMat = new THREE.ShaderMaterial({
  uniforms: signUniforms,
  side: THREE.DoubleSide,
  vertexShader:`
    attribute vec3 aCol;
    varying vec3 vC, vW, vN;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vC = aCol;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader:`
    precision highp float;
    uniform float uNight, uFogDensity;
    uniform vec3 uFogColor;
    varying vec3 vC, vW, vN;
    void main(){
      vec3 n = normalize(vN);
      float f = 0.74 + 0.26 * abs(dot(n, normalize(vec3(0.42, 0.78, 0.32))));
      /* 白天：有朝向的彩色板；夜里：灯箱自发光，颜色更亮更饱和 */
      vec3 day = vC * f * 0.95;
      vec3 night = vC * (1.45 + 0.45 * f);
      vec3 c = mix(day, night, uNight);
      float d = length(cameraPosition - vW);
      float fog = 1.0 - exp(-uFogDensity*uFogDensity*d*d);
      gl_FragColor = vec4(mix(c, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
    }`,
});

const signBuilt = (()=>{
  const P = [], Nn = [], C = [];
  const pal = SIGN_PAL.map(h => new THREE.Color(h));
  const col = new THREE.Color();

  function quad(a, b, c2, d, nx, ny, nz){
    const verts = [a, b, c2, a, c2, d];
    for(const v of verts){
      P.push(v[0], v[1], v[2]);
      Nn.push(nx, ny, nz);
      C.push(col.r, col.g, col.b);
    }
  }

  let n = 0, skipped = 0;
  const list = BD.all;
  for(let bi=0; bi<list.length; bi++){
    const b = list[bi];
    if(b.h < 5.5 || b.h > 46) continue;          // 只给街边低多层挂招牌
    if(b.n < 3) continue;
    if((bi & 3) === 0) { skipped++; continue; }   // 抽稀，控制总量

    /* 找最长的一条边（多半临街），再确认它离道路不远 */
    let bestK = -1, bestLen = 0;
    for(let k=0;k<b.n;k++){
      const k2 = (k+1)%b.n;
      const len = Math.hypot(b.pts[k2*2]-b.pts[k*2], b.pts[k2*2+1]-b.pts[k*2+1]);
      if(len > bestLen){ bestLen = len; bestK = k; }
    }
    if(bestK < 0 || bestLen < 6) continue;
    const k2 = (bestK+1)%b.n;
    const ax = b.pts[bestK*2], az = b.pts[bestK*2+1];
    const bx = b.pts[k2*2], bz = b.pts[k2*2+1];
    const mx = (ax+bx)*0.5, mz = (az+bz)*0.5;
    const near = RNB.nearest(mx, mz, -1, 0, 1);
    if(near[0] > 16) continue;                    // 不临街就不挂

    /* 边方向与外法线（背离建筑中心） */
    let ux = (bx-ax)/bestLen, uz = (bz-az)/bestLen;
    let nx = -uz, nz = ux;
    let cx = 0, cz = 0;
    for(let k=0;k<b.n;k++){ cx += b.pts[k*2]; cz += b.pts[k*2+1]; }
    cx /= b.n; cz /= b.n;
    if((mx-cx)*nx + (mz-cz)*nz < 0){ nx = -nx; nz = -nz; }

    /* 招牌尺寸与高度 */
    const rnd = ((bi * 2654435761) >>> 0) / 4294967296;
    const w = Math.min(bestLen * (0.45 + 0.22*rnd), 4.6);
    const hgt = 0.75 + 0.45 * rnd;
    const dep = 0.34;
    const y = b.y0 + Math.max(3.4, Math.min(b.h * 0.34, 7.6));
    const off = 0.22 + dep*0.5;

    col.copy(pal[(bi * 7 + (bi >> 3)) % pal.length]);
    const sx = mx + nx*off, sz = mz + nz*off;

    /* 8 个角：沿 u 展宽、沿 n 出挑、竖直 hgt */
    const ex = ux*w*0.5, ez = uz*w*0.5;
    const ox = nx*dep*0.5, oz = nz*dep*0.5;
    const hh = hgt*0.5;
    const p = (su, sv, sy) => [sx + ex*su + ox*sv, y + sy*hh, sz + ez*su + oz*sv];
    const c000 = p(-1,-1,-1), c100 = p(1,-1,-1), c110 = p(1,-1,1), c010 = p(-1,-1,1);
    const c001 = p(-1, 1,-1), c101 = p(1, 1,-1), c111 = p(1, 1,1), c011 = p(-1, 1,1);
    quad(c001, c101, c111, c011,  nx, 0, nz);        // 正面（朝外）
    quad(c100, c000, c010, c110, -nx, 0, -nz);       // 背面
    quad(c000, c001, c011, c010,  ux, 0, uz);        // 侧面
    quad(c101, c100, c110, c111, -ux, 0, -uz);
    quad(c010, c011, c111, c110, 0, 1, 0);
    quad(c000, c100, c101, c001, 0, -1, 0);
    n++;
  }

  if(!n) return { count: 0 };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  geo.setAttribute('aCol', new THREE.Float32BufferAttribute(C, 3));
  const mesh = new THREE.Mesh(geo, signMat);
  mesh.frustumCulled = false;
  world.add(mesh);
  return { count: n, tris: (P.length/9)|0, skipped };
})();
