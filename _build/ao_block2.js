/* ============================================================
   7c. SSAO（阶段 3 欠账，第二版）
   深度不走 depth buffer：near=1/far=20000 时 300m 外全挤在 0.997~1.0，
   非线性精度根本不够算 AO。改成「线性深度预通道」——
   用 overrideMaterial 把 -viewZ/far 写进 HalfFloat 颜色缓冲，精度均匀。
   ============================================================ */
const AO_SCALE = 0.5;
let AO_STRENGTH = 0.55;
const AO_FAR = 12000;
const AO_DBG = (() => {
  const m = /[?&]ao=(\d)/.exec(location.search);
  return m ? +m[1] : 0;
})();

const aoDepthRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: true });
const aoRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.UnsignedByteType, depthBuffer: false });
const aoBlurRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.UnsignedByteType, depthBuffer: false });

/* 线性深度材质：同时给法线重建用 */
const aoLinMat = new THREE.ShaderMaterial({
  uniforms: { uFar: { value: AO_FAR } },
  vertexShader: `
    varying float vZ;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vZ = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    precision highp float;
    uniform float uFar;
    varying float vZ;
    void main(){ gl_FragColor = vec4(vZ / uFar, 0.0, 0.0, 1.0); }`,
});

const aoQuad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), null);
const aoScene = new THREE.Scene(); aoScene.add(aoQuad);
const aoCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

const aoMat = new THREE.ShaderMaterial({
  uniforms:{ tLin:{value:null}, tNoise:{value:null},
             uRes:{value:new THREE.Vector2(1,1)}, uFar:{value:AO_FAR},
             uProjXY:{value:new THREE.Vector2(1,1)},
             uRadius:{value:1.8}, uBias:{value:0.06}, uIntensity:{value:0.95} },
  vertexShader:`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader:`
    precision highp float;
    uniform sampler2D tLin, tNoise;
    uniform vec2 uRes, uProjXY;
    uniform float uFar, uRadius, uBias, uIntensity;
    varying vec2 vUv;

    /* 由线性深度换回 view 空间坐标（z 为负） */
    vec3 viewPos(vec2 uv){
      float z = texture2D(tLin, uv).r * uFar;
      vec2 ndc = uv * 2.0 - 1.0;
      return vec3(ndc.x * z * uProjXY.x, ndc.y * z * uProjXY.y, -z);
    }
    void main(){
      float lin = texture2D(tLin, vUv).r * uFar;
      if(lin <= 0.001 || lin >= uFar * 0.98){ gl_FragColor = vec4(1.0); return; }
      vec3 p = viewPos(vUv);
      vec3 dx = viewPos(vUv + vec2(1.0/uRes.x, 0.0)) - p;
      vec3 dy = viewPos(vUv + vec2(0.0, 1.0/uRes.y)) - p;
      vec3 n = normalize(cross(dx, dy));
      if(dot(n, -p) < 0.0) n = -n;

      vec3 rnd = texture2D(tNoise, vUv * uRes / 4.0).xyz * 2.0 - 1.0;
      vec3 t = rnd - n * dot(rnd, n);
      if(length(t) < 0.05) t = vec3(n.y, -n.x, 0.0);
      t = normalize(t);
      vec3 b = cross(n, t);
      mat3 tbn = mat3(t, b, n);

      float occ = 0.0;
      const int K = 12;
      for(int i = 0; i < K; i++){
        float fi = float(i) + 0.5;
        float r = uRadius * sqrt(fi / float(K));
        float th = fi * 2.39996323;
        vec3 sp = p + tbn * vec3(cos(th) * r, sin(th) * r, r * 0.55 + uBias);
        float sz = -sp.z;
        if(sz <= 0.001) continue;
        vec2 ndc = vec2(sp.x / (sz * uProjXY.x), sp.y / (sz * uProjXY.y));
        vec2 suv = ndc * 0.5 + 0.5;
        if(suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
        float sl = texture2D(tLin, suv).r * uFar;
        if(sl <= 0.001 || sl >= uFar * 0.98) continue;
        /* sl 比 sz 小 → 该像素的表面比样本更近 → 样本被挡 */
        float diff = sz - sl;
        float range = 1.0 - smoothstep(uRadius * 0.5, uRadius * 2.2, abs(diff));
        occ += step(uBias, diff) * range;
      }
      float ao = 1.0 - (occ / float(K)) * uIntensity;
      gl_FragColor = vec4(vec3(clamp(ao, 0.0, 1.0)), 1.0);
    }`,
});

const aoBlurMat = new THREE.ShaderMaterial({
  uniforms:{ tAO:{value:null}, tLin:{value:null}, uRes:{value:new THREE.Vector2(1,1)} },
  vertexShader:`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader:`
    precision highp float;
    uniform sampler2D tAO, tLin; uniform vec2 uRes;
    varying vec2 vUv;
    void main(){
      float d0 = texture2D(tLin, vUv).r;
      float sum = 0.0, wsum = 0.0;
      for(int j=-1;j<=1;j++){
        for(int i=-1;i<=1;i++){
          vec2 uv = vUv + vec2(float(i), float(j)) / uRes;
          float d = texture2D(tLin, uv).r;
          float w = (abs(d - d0) < 0.0015) ? 1.0 : 0.08;
          sum += texture2D(tAO, uv).r * w; wsum += w;
        }
      }
      gl_FragColor = vec4(vec3(sum / max(wsum, 1e-4)), 1.0);
    }`,
});

let AO_HIDE = null;
function aoDepthPrepass(){
  if(!AO_HIDE){
    AO_HIDE = [];
    scene.traverse(o => {
      if(o.isMesh && o !== cityMesh && o !== terrainMesh && o !== aoQuad) AO_HIDE.push(o);
    });
  }
  for(const m of AO_HIDE){ m.__v = m.visible; m.visible = false; }
  const prevOverride = scene.overrideMaterial;
  scene.overrideMaterial = aoLinMat;
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(aoDepthRT);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);
  scene.overrideMaterial = prevOverride;
  for(const m of AO_HIDE) m.visible = m.__v;
}

const aoPass = {
  enabled: true, needsSwap: false, clear: false,
  render(){
    if(AO_STRENGTH <= 0.001 && AO_DBG === 0) return;
    aoDepthPrepass();
    aoMat.uniforms.tLin.value = aoDepthRT.texture;
    aoMat.uniforms.uProjXY.value.set(
      1.0 / camera.projectionMatrix.elements[0],
      1.0 / camera.projectionMatrix.elements[5]
    );
    aoQuad.material = aoMat;
    renderer.setRenderTarget(aoRT);
    renderer.render(aoScene, aoCam);
    aoBlurMat.uniforms.tAO.value = aoRT.texture;
    aoBlurMat.uniforms.tLin.value = aoDepthRT.texture;
    aoQuad.material = aoBlurMat;
    renderer.setRenderTarget(aoBlurRT);
    renderer.render(aoScene, aoCam);
    renderer.setRenderTarget(null);
    gradePass.uniforms.tAO.value = aoBlurRT.texture;
    gradePass.uniforms.tDepthV.value = aoDepthRT.texture;
    gradePass.uniforms.uAODbg.value = AO_DBG;
    gradePass.uniforms.uAOStr.value = AO_STRENGTH;
  },
  setSize(w, h){
    const aw = Math.max(2, Math.round(w * AO_SCALE)), ah = Math.max(2, Math.round(h * AO_SCALE));
    aoDepthRT.setSize(aw, ah); aoRT.setSize(aw, ah); aoBlurRT.setSize(aw, ah);
    aoMat.uniforms.uRes.value.set(aw, ah);
    aoBlurMat.uniforms.uRes.value.set(aw, ah);
  },
};
composer.passes.splice(1, 0, aoPass);
aoPass.setSize(innerWidth * Math.min(window.devicePixelRatio, 1.75), innerHeight * Math.min(window.devicePixelRatio, 1.75));
window.__AO = { rt: aoBlurRT, depthRT: aoDepthRT, mat: aoMat, blur: aoBlurMat };
