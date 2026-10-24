# 树的几何：球体 → 程序化叶片贴图 + 交叉面片（用区间切分，避免 vs/fs 混淆）
p = '_build/template_dev.html'
s = open(p, encoding='utf-8').read()
orig = len(s)

# ---------- 1) 叶片纹理 + 交叉面片几何 ----------
leaf_fn = '''/* ---------- 叶片纹理：径向密度递减的椭圆叶簇，左上角留一块不透明树皮色 ---------- */
function makeLeafTex(){
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, N, N);
  g.fillStyle = '#6b4f36';                 // 树皮取样区（树干 UV 指向这里）
  g.fillRect(0, 0, 24, 24);

  const CX = N/2, CY = N/2, R = N*0.46;
  for(let i=0;i<1400;i++){
    const a = Math.random()*Math.PI*2;
    const rr = Math.pow(Math.random(), 0.62) * R;
    const x = CX + Math.cos(a)*rr, y = CY + Math.sin(a)*rr;
    const rot = Math.random()*Math.PI;
    const L = 4.5 + Math.random()*8.5;
    const W = 2.2 + Math.random()*3.6;
    const t = rr / R;
    const lum = (0.30 + 0.95*(1-t*t)) * (0.62 + 0.38*Math.random());
    const r = Math.round(52*lum), gg = Math.round(104*lum), b = Math.round(40*lum);
    g.save();
    g.translate(x, y); g.rotate(rot);
    g.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
    g.beginPath(); g.ellipse(0, 0, L, W, 0, 0, Math.PI*2); g.fill();
    g.restore();
  }
  for(let i=0;i<320;i++){
    const a = Math.random()*Math.PI*2;
    const rr = (0.82 + Math.random()*0.26) * R;
    const x = CX + Math.cos(a)*rr, y = CY + Math.sin(a)*rr;
    g.save();
    g.translate(x, y); g.rotate(Math.random()*Math.PI);
    g.fillStyle = 'rgba(' + (28 + Math.random()*24|0) + ',' + (58 + Math.random()*34|0) + ',22,0.95)';
    g.beginPath(); g.ellipse(0, 0, 3 + Math.random()*5, 1.6 + Math.random()*2.4, 0, 0, Math.PI*2); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;   // shader 里手动 pow 2.2
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}
const LEAF_TEX = makeLeafTex();

/* ---------- 交叉面片树：近景 3 片、远景 1 片 ---------- */
function vegGeo(far){
  const parts = [];
  if(!far){
    const trunk = new THREE.CylinderGeometry(0.018, 0.042, 0.46, 5, 1, true);
    trunk.translate(0, 0.23, 0);
    const uv = trunk.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i, 0.045, 0.955);
    parts.push([trunk, 0, 0, 0.23, 0]);
  }
  const planes = far ? 1 : 3;
  for(let i=0;i<planes;i++){
    const q = new THREE.PlaneGeometry(1.0, 1.0, 1, 1);
    q.translate(0, 0.5, 0);
    if(planes > 1) q.rotateY(i * Math.PI / planes);
    else q.rotateY(0.6);
    parts.push([q, 1, 0, 0.5, 0]);
  }

  let vc = 0, ic = 0;
  for(const [g] of parts){
    if(!g.index){
      const a = [];
      for(let i=0;i<g.attributes.position.count;i++) a.push(i);
      g.setIndex(a);
    }
    vc += g.attributes.position.count; ic += g.index.count;
  }
  const pos = new Float32Array(vc*3), nrm = new Float32Array(vc*3), part = new Float32Array(vc);
  const uvs = new Float32Array(vc*2);
  const idx = new Uint16Array(ic);
  let vo = 0, io = 0;
  for(const [g, pt] of parts){
    const P = g.attributes.position.array, I = g.index.array;
    const U = g.attributes.uv ? g.attributes.uv.array : null;
    pos.set(P, vo*3);
    if(U) uvs.set(U, vo*2);
    for(let k=0;k<I.length;k++) idx[io+k] = I[k] + vo;
    part.fill(pt, vo, vo + g.attributes.position.count);
    vo += g.attributes.position.count; io += I.length;
  }
  let o2 = 0;
  for(const [g, pt] of parts){
    const cnt = g.attributes.position.count;
    if(pt > 0.5){
      for(let i=0;i<cnt;i++){
        const p = o2 + i;
        const dy = pos[p*3+1] - 0.52;
        const dx = pos[p*3] * 0.85, dz = pos[p*3+2] * 0.85;
        const L = Math.hypot(dx, dy, dz) || 1;
        nrm[p*3] = dx/L; nrm[p*3+1] = (dy/L)*0.72 + 0.36; nrm[p*3+2] = dz/L;
      }
    } else {
      for(let i=0;i<cnt;i++){
        const p = o2 + i;
        nrm[p*3] = pos[p*3]*2.4; nrm[p*3+1] = 0.15; nrm[p*3+2] = pos[p*3+2]*2.4;
      }
    }
    o2 += cnt;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm,3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs,2));
  g.setAttribute('aPart', new THREE.BufferAttribute(part,1));
  g.setIndex(new THREE.BufferAttribute(idx,1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0,0.5,0), 1.6);
  return g;
}'''

start = s.find("function vegGeo(far){")
endm = "  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0,0.5,0), 1.4);\n  return g;\n}"
end = s.find(endm, start)
assert start > 0 and end > start, 'vegGeo range'
s = s[:start] + leaf_fn + s[end + len(endm):]

# ---------- 2) 只改 vertexShader 区间 ----------
vm = s.index("const vegMat = new THREE.ShaderMaterial({")
vs_a = s.index("  vertexShader:`", vm)
fs_a = s.index("  fragmentShader:`", vs_a)
vs = s[vs_a:fs_a]
fs = s[fs_a:]

def rep_in(txt, a, b, tag):
    assert txt.count(a) == 1, 'anchor fail: ' + tag
    return txt.replace(a, b)

vs = rep_in(vs, """    varying vec3 vCol, vW, vN;
    varying float vH, vSeed, vPart;""",
"""    varying vec3 vCol, vW, vN;
    varying float vH, vSeed, vPart;
    varying vec2 vUv;""", 'vs vary')

vs = rep_in(vs, """      vW = wp; vH = lp.y; vCol = aCol; vSeed = aSeed; vPart = aPart;""",
"""      vW = wp; vH = lp.y; vCol = aCol; vSeed = aSeed; vPart = aPart;
      vUv = uv;""", 'vs uv')

# uv 属性由 geometry 提供，three 的 ShaderMaterial 不自动声明
vs = rep_in(vs, """    attribute float aPart;
    attribute vec3 aCol;
    attribute float aSeed;""",
"""    attribute float aPart;
    attribute vec3 aCol;
    attribute float aSeed;
    attribute vec2 uv;""", 'vs attr')

# ---------- 3) 只改 fragmentShader 区间 ----------
fs = rep_in(fs, """    uniform vec4 uSolo;
    varying vec3 vCol, vW, vN;
    varying float vH, vSeed, vPart;""",
"""    uniform vec4 uSolo;
    uniform sampler2D uLeaf;
    uniform float uAlphaCut;
    varying vec3 vCol, vW, vN;
    varying float vH, vSeed, vPart;
    varying vec2 vUv;""", 'fs vary')

fs = rep_in(fs, """      vec3 tr = vPart > 0.5 ? vCol : vec3(0.050,0.038,0.028)*(0.6 + 0.8*vSeed);""",
"""      vec3 tr = vCol;
      if(vPart > 0.5){
        vec4 tx = texture2D(uLeaf, vUv);
        if(tx.a < uAlphaCut) discard;
        tr = pow(tx.rgb, vec3(2.2)) * vCol * 2.1;    // 叶片明暗 × 实例色调
      } else {
        vec3 bark = texture2D(uLeaf, vUv).rgb;
        tr = pow(bark, vec3(2.2)) * (0.75 + 0.5*vSeed);
      }""", 'fs leaf')

s = s[:vs_a] + vs + fs
open(p, 'w', encoding='utf-8').write(s)
print('ok  %d -> %d' % (orig, len(s)))
