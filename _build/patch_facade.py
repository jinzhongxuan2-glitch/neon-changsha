import pathlib, re

p = pathlib.Path(__file__).resolve().parent / "template_dev.html"
s = p.read_text(encoding="utf-8")

start = s.index("const cityMat = new THREE.ShaderMaterial({")
end_marker = "const cityMesh = new THREE.Mesh(cityBuilt.geo, cityMat);"
end = s.index(end_marker)

new_block = r'''const cityMat = new THREE.ShaderMaterial({
  uniforms: cityUniforms,
  vertexShader:`
    attribute vec4 aMeta;
    varying vec3 vW; varying vec4 vM;
    void main(){
      vec4 wp = modelMatrix * vec4(position,1.0);
      vW = wp.xyz; vM = aMeta;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader:`
    precision highp float;
    uniform float uTime,uHour,uFogDensity,uDbgCity;
    uniform vec3 uFogColor,uNeonA,uNeonB;
    uniform vec3 uTint0,uTint1,uTint2,uTint3,uTint4,uTint5,uTint6,uTint7;
    varying vec3 vW; varying vec4 vM;

    float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }

    vec3 tintOf(float i){
      if(i<0.5) return uTint0; if(i<1.5) return uTint1; if(i<2.5) return uTint2; if(i<3.5) return uTint3;
      if(i<4.5) return uTint4; if(i<5.5) return uTint5; if(i<6.5) return uTint6; return uTint7;
    }

    /* 天光反射：玻璃幕墙的关键 */
    vec3 skyGrad(vec3 R){
      float t = clamp(R.y*0.5+0.5, 0.0, 1.0);
      return mix(vec3(0.040,0.050,0.068), vec3(0.009,0.013,0.023), pow(t,0.62));
    }

    /* 矩形窗洞：g 为分格坐标，lo/hi 为窗在格内的起止比例 */
    float winMask(vec2 g, vec2 lo, vec2 hi){
      vec2 f = fract(g);
      float wx = smoothstep(lo.x, lo.x+0.035, f.x)*(1.0-smoothstep(hi.x-0.035, hi.x, f.x));
      float wy = smoothstep(lo.y, lo.y+0.05, f.y)*(1.0-smoothstep(hi.y-0.05, hi.y, f.y));
      return wx*wy;
    }

    void main(){
      vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
      vec3 V = normalize(cameraPosition - vW);
      if(dot(n,V) < 0.0) n = -n;
      float dist = length(cameraPosition - vW);
      float fogF = 1.0 - exp(-uFogDensity*uFogDensity*dist*dist);

      float h = vM.y, mode = vM.z, seed = vM.x;
      vec3 vTint = tintOf(vM.w);
      float hn = clamp(vW.y/max(h,1.0), 0.0, 1.0);
      vec3 col;

      if(n.y > 0.62){
        /* ---------- 屋顶 ---------- */
        float r = h21(floor(vW.xz*0.37) + seed*11.0);
        col = vec3(0.0075,0.0090,0.0125)*(0.7+0.8*r);
        col += vec3(0.030,0.036,0.052)*smoothstep(0.55,0.95,r)*0.30;
        float eq = h21(floor(vW.xz*0.09)+seed);
        col += vec3(0.020,0.024,0.032)*smoothstep(0.86,0.98,eq);
      } else {
        /* ---------- 立面 ---------- */
        float st = floor(mode + 0.5);
        vec2 fuv = (abs(n.x) > 0.5) ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y);
        float y = vW.y;
        float ndl = max(dot(n, normalize(vec3(0.42,0.55,0.62))), 0.0);

        /* 墙基色：夜间极暗，靠窗光与反射形成对比 */
        vec3 wall = vec3(0.0085,0.0080,0.0078) * (0.62 + 0.72*h21(vec2(seed*31.0, 2.0)));
        wall *= (0.45 + 0.80*clamp(n.y*0.4+0.7, 0.0, 1.0));
        wall *= (0.55 + 0.75*ndl);

        /* 窗光：暖白为主，冷白为辅 */
        vec3 warm = vec3(1.00,0.760,0.470);
        vec3 cool = vec3(0.78,0.88,1.00);
        vec3 lc = mix(warm, cool, step(0.78, h21(vec2(seed*91.0, 7.3))));

        float floorH, winW;
        float aa;
        vec3 emis = vec3(0.0);

        if(st < 0.5){
          /* ===== 0 面砖住宅：小窗 + 阳台 + 空调机位 ===== */
          floorH = 2.95; winW = 3.85;
          vec2 g = vec2(fuv.x/winW, y/floorH);
          aa = 1.0 - smoothstep(0.20,0.72, max(fwidth(g.x), fwidth(g.y)));
          float w = winMask(g, vec2(0.26,0.34), vec2(0.74,0.86));
          float fl = h21(vec2(floor(g.y), seed*131.0));
          float lit = step(0.80, fl) * step(0.35, h21(floor(g)+seed*57.0));
          lit = max(lit, step(0.955, h21(vec2(floor(g.y), seed*7.7))));
          emis += lc * w * lit * (0.55 + 0.30*uHour);

          /* 阳台：每 3 层一道，下沿投影更深 */
          float bal = step(0.5, fract(floor(g.y)/3.0)) * smoothstep(0.88,0.97,fract(g.y)) * (1.0-smoothstep(0.97,1.0,fract(g.y)));
          wall *= mix(1.0, 0.45, bal);
          col = wall + emis;

          /* 空调外机 */
          vec2 acg = floor(vec2(fuv.x/1.9, y/2.95));
          float acm = step(0.72, h21(acg + seed*23.0)) * smoothstep(0.30,0.34,fract(fuv.x/1.9)) * (1.0-smoothstep(0.46,0.50,fract(fuv.x/1.9)));
          col = mix(col, vec3(0.006,0.006,0.007), acm*0.85);
        }
        else if(st < 1.5 || (st > 9.5 && st < 11.5)){
          /* ===== 1 玻璃幕墙 / 11 地标塔楼 ===== */
          floorH = (st > 10.5) ? 4.2 : 3.9;
          winW = (st > 10.5) ? 1.65 : 1.5;
          vec2 g = vec2(fuv.x/winW, y/floorH);
          aa = 1.0 - smoothstep(0.16,0.62, max(fwidth(g.x), fwidth(g.y)));
          float spandrel = smoothstep(0.83,0.93,fract(g.y));
          vec2 gf = fract(g);

          /* 玻璃：天光反射 + 室内 */
          vec3 R = reflect(-V, n);
          float fres = pow(1.0 - max(dot(n,V),0.0), 2.5);
          vec3 refl = skyGrad(R) * (0.35 + 1.10*fres);

          float mull = smoothstep(0.03,0.00,min(gf.x,1.0-gf.x)) + spandrel*0.9;
          float glassA = (1.0 - mull);

          float fl = h21(vec2(floor(g.y), seed*131.0));
          float lit = step(0.62, fl) * step(0.25, h21(floor(g)+seed*57.0));
          lit = max(lit, step(0.90, h21(vec2(floor(g.y)*0.5, seed*7.7))));

          vec3 glassCol = vec3(0.006,0.008,0.013) + refl*0.85;
          glassCol += lc * lit * (0.85 + 0.45*uHour) * mix(0.35, 1.0, step(0.5, h21(floor(g)+seed*11.0)));
          col = mix(wall*1.1, glassCol, glassA);

          if(st > 10.5){
            /* 地标：竖向装饰带 + 冠部 */
            float rib = smoothstep(0.965,0.995, fract(fuv.x/9.0));
            col += vTint * rib * 0.55;
            col += vec3(0.55,0.72,1.0) * smoothstep(h-2.5, h-0.6, y) * 0.9;
          }
        }
        else if(st < 2.5){
          /* ===== 2 带形窗（办公/医院/学校） ===== */
          floorH = 3.6; winW = 1.6;
          vec2 g = vec2(fuv.x/winW, y/floorH);
          aa = 1.0 - smoothstep(0.18,0.68, max(fwidth(g.x), fwidth(g.y)));
          float w = winMask(g, vec2(0.04,0.26), vec2(0.96,0.80));
          float fl = h21(vec2(floor(g.y), seed*131.0));
          float lit = step(0.70, fl) * step(0.30, h21(floor(g)+seed*57.0));
          emis += lc * w * lit * (0.62 + 0.34*uHour);
          col = wall + emis;
        }
        else if(st < 3.5){
          /* ===== 3 石材干挂 ===== */
          floorH = 3.9; winW = 3.0;
          vec2 g = vec2(fuv.x/winW, y/floorH);
          aa = 1.0 - smoothstep(0.18,0.70, max(fwidth(g.x), fwidth(g.y)));
          /* 石材板缝 */
          vec2 pg = vec2(fuv.x/1.25, y/1.25);
          float joint = smoothstep(0.02,0.0,min(fract(pg.x),1.0-fract(pg.x))) + smoothstep(0.02,0.0,min(fract(pg.y),1.0-fract(pg.y)));
          wall *= (1.0 - joint*0.45);
          float w = winMask(g, vec2(0.24,0.30), vec2(0.76,0.78));
          float lit = step(0.84, h21(vec2(floor(g.y), seed*131.0))) * step(0.4, h21(floor(g)+seed*3.0));
          emis += lc * w * lit * (0.55 + 0.30*uHour);
          col = wall*(1.05 - joint*0.35) + emis;
        }
        else if(st < 4.5){
          /* ===== 4 老城砖混 ===== */
          floorH = 3.0; winW = 3.1;
          vec2 g = vec2(fuv.x/winW, y/floorH);
          aa = 1.0 - smoothstep(0.22,0.78, max(fwidth(g.x), fwidth(g.y)));
          wall *= 1.15;
          float w = winMask(g, vec2(0.30,0.30), vec2(0.70,0.74));
          float lit = step(0.72, h21(floor(g)+seed*57.0));
          emis += lc * w * lit * (0.50 + 0.26*uHour);
          col = wall + emis;
        }
        else {
          /* ===== 5 商业裙房 ===== */
          floorH = 5.2; winW = 3.0;
          vec2 g = vec2(fuv.x/winW, y/floorH);
          aa = 1.0 - smoothstep(0.18,0.70, max(fwidth(g.x), fwidth(g.y)));
          float w = winMask(g, vec2(0.03,0.10), vec2(0.97,0.88));
          float lit = step(0.35, h21(floor(g)+seed*57.0));
          emis += lc * w * lit * (0.95 + 0.45*uHour) * 1.25;
          col = wall + emis;
        }

        /* 远距离：按屏幕导数平滑，但保留每栋各自的亮灯率 */
        float bldgLit = 0.06 + 0.26*h21(vec2(seed*77.0, 9.1));
        col = mix(col, mix(wall, lc*(0.10+0.42*bldgLit), 0.55), 1.0-aa);

        /* 底层商铺带 */
        if(h > 12.0){
          float shopTop = min(7.0, max(4.5, h*0.22));
          float shop = smoothstep(3.6,4.4,y) * (1.0-smoothstep(shopTop-0.8, shopTop, y));
          float sgn = smoothstep(0.5,0.9, h21(vec2(floor(fuv.x/7.0), seed*17.0)));
          col += (vec3(1.0,0.62,0.34) + vec3(0.35,0.15,0.55)*sgn) * shop * 0.55;
        }

        /* 顶部女儿墙勾勒 */
        col += vec3(0.030,0.034,0.040) * smoothstep(h-1.1, h-0.35, y);

        /* 滨江灯光秀 */
        if(mode > 9.5 && mode < 10.5){
          float band = floor(fuv.y/9.0);
          float ph = fract(band*0.02 + vW.z*0.00030 + uTime*0.018 + seed*0.1);
          vec3 mc = mix(vec3(1.0,0.72,0.34), vec3(0.42,0.74,1.0), 0.5+0.5*sin(ph*6.28318));
          col += mc * 0.22 * (0.5+0.5*sin(vW.y*0.09 + uTime*0.5));
        }

        /* 高楼航空障碍灯 */
        if(h > 200.0 && fract(seed*3.71) > 0.45){
          float bl = fract(uTime*0.55 + seed*0.31);
          float blink = smoothstep(0.0,0.05,bl) * (1.0-smoothstep(0.12,0.20,bl));
          col += vec3(1.0,0.18,0.14) * blink * smoothstep(h-1.4, h-0.3, y) * 0.8;
        }
      }

      col = mix(col, uFogColor, clamp(fogF,0.0,1.0));
      if(uDbgCity > 0.5){ gl_FragColor = vec4(mode/12.0, hn, clamp(n.y,0.0,1.0), 1.0); return; }
      gl_FragColor = vec4(col,1.0);
    }`
});

'''

s = s[:start] + new_block + s[end:]
p.write_text(s, encoding="utf-8")
print("replaced, new len", len(s))
