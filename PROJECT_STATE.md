# PROJECT_STATE · 长沙湘江三维城市

> 新会话从这里开始。读完本文件即可继续开发，不需要历史对话。
> 最后更新：2026-10-21

---

## 1. 项目是什么

`neon-changsha`（仓库根目录）—— 基于真实 OSM 数据的长沙（湘江/橘子洲/岳麓山/中南大学）三维城市，
单页 Three.js（无框架），支持 24 小时光照、四种天气、六个视角预设、自由/巡航/步行三种相机。

> 所有脚本都已改成相对路径（`_build/_pw.js` / `_build/_env.py` 统一解析 node、playwright-core
> 和 chromium），换机器不用改代码；需要时用 `PW_CORE` / `PW_EXE` / `NEON_NODE` / `NEON_NODE_MODULES` 覆盖。

**双产物**：
| 文件 | 说明 |
|---|---|
| `index.html` | 单文件 2.71MB，贴图 base64 内联，双击即可运行 |
| `dist/` | 部署版：`index.html` 0.90MB + `assets/` 2.81MB（城市数据 + 768² 贴图，内容哈希命名） |

---

## 2. 目录与文件

```
_data/          原始数据管线（process.py 生成 city.json / terrain.json / water.png）
  out/city.json   1.47MB：buildings/roads/areas/terrain 的 base64 + meta
_build/
  template_dev.html   ★ 唯一的源码，4400+ 行（改代码都在这里改）
  build.py            ★ 一条命令重建（bat 只是它的壳）
  make_dev.py         注入 city.json + 水遮罩 → dev.html
  extract.py          dev.html 的 module 体 → app.js + template.html
  inline.py           bundle.js → index.html（单文件）
  externalize.py      外置数据/贴图 + 哈希命名 + gzip → dist/
  serve.py            本地预览 dist/（正确缓存头 + gzip_static）
  shots.js            ★ 8 个固定机位截图 + 指标（--mode diff|pretty）
  diff.js             ★ 像素对比（canvas，无依赖）+ 热力图
  gate.py             ★ 回归闸门：拍 → 比 → PASS/FAIL
  err.js / shot*.js / probe*.js   Playwright 调试与截图脚本
  pxprobe.py          自写 PNG 解码（本机无 PIL 时装了 venv）
vendor/         three.module.js + postprocessing / controls / Reflector
_tex/           贴图源：512/（单文件用）、768/（dist 用）、1k/（部署用）
_shots/         历史截图（211MB）
_audit/         回归基线：baseline/ 8 张 PNG + meta.json
```

**重建命令**：`rebuild.bat`（壳）→ `python _build/build.py`（依次 make_dev → extract → esbuild → inline → externalize）
**回归**：`python _build/gate.py`（夜间 mean ≤ 0.20 / pct8 ≤ 0.15% 才算过）

> 计划、阶段拆解、决策日志都在 **`ROADMAP.md`**，那是唯一的活文档；本文件只记技术现状与踩坑。

---

## 3. 渲染管线（template_dev.html 内的顺序）

1. **天空**：shader 球，`SKY_KEYS[]` 按太阳高度角插值 24h 光照；`applyTime(hour)` 是总开关
2. **建筑**：19,524 栋合并成一个 BufferGeometry（`aMeta/aBase/aTag`）。
   `mode` 管立面体系（9 种：住宅/幕墙/板式/石材/砖/商业/校园/媒体/塔楼）；
   `func` 管功能语义（5 bit，11 类），决定亮灯率、灯色、底层商铺与白天色差。
   昼间另有 windows/lintel/streak/商铺叠加；夜间窗格 + 灯带
2b. **阴影**：自建 2 级 CSM（700m / 6km，2048²，BasicShadowMap 原始深度 + 手写 3×3 PCF）。
   深度图由两个 intensity 无关的平行光承载，材质里用 `shadowAt(worldPos, normal)` 手动采样；
   `SHADOW_GLSL` 注入到 city / roof / road / terrain / veg 五个 shader。LOW 档关闭并回退假投影
2c. **天空辐照**：`SKYIRR` 在 CPU 侧把天空渐变积成 **SH9**（256 方向），`applyTime` 重算；
   shader 里 `skyIrr(n)` 用余弦卷积权重展开。夜间用 `mix(..., uDay)` 退回旧的标量 amb，保证逐像素不变
3. **屋顶设备**：独立 mesh，女儿墙/楼梯间/水箱/空调/太阳能 + 接地阴影，上限 270 万顶点
4. **路网**：`RNB` 空间索引；斑马线、路缘石、车道线、人行道；**路灯池用烘进顶点的 `aLO` 反解**，与灯杆严格对齐
5. **水面**：Reflector + 真实岸线遮罩
6. **植被**：37k 棵，按 1.1km 区块切块的 InstancedMesh（视锥剔除），近景树干+双球冠 / 远景单球冠
7. **街景**：停放车辆 13.6k、灯杆 7.3k
8. **车流**：18k 辆，2 组轮转（30Hz/车），实例只传 `aPos+aYaw+aScale`
9. **行人**：3.2k 行人 + 1.1k 电动车，腿部摆动在顶点着色器
10. **信号灯**：3024 个路口闸位，红黄绿颜色全在着色器里按 `uTime` 算出
11. **后期**：UnrealBloom + 自定义 grade pass

---

## 4. 踩过的坑（重要，别重复）

| 坑 | 结论 |
|---|---|
| `InstancedMesh.instanceMatrix` 每帧改 | **必须 `setUsage(DynamicDrawUsage)`**，否则驱动整块重建，帧率掉到 17 |
| 实例矩阵 16 float | 只有 pos/yaw/scale 会变，改自定义属性 16f→5f，带宽降 69% |
| `patch` 是 GLSL ES 3.0 保留字 | 变量名撞上直接编译失败 |
| `discard` | 会关掉 early-z，改用顶点着色器推 `gl_Position` 出裁剪体 |
| 立面白天是白盒子 | 夜间和昼间是**两套独立分支**，窗格信息要用 `dWin/dG` 提升到外层共享 |
| 冷白平板 | 根因是「滨江灯光秀」`col += mc*0.22` **没做遮罩**，整面铺满 |
| 贴图破坏明度关系 | 沥青用 `lum/mean` 无界调制会亮到和地面同色 → 必须 `clamp(0.62,1.42)` |
| base64 不是瓶颈 | gzip 已吃掉 33% 膨胀，改二进制收益≈0 |
| 帧率测量 | **外部 rAF 轮询会和应用自身 rAF 抢资源**，一律读 `#s-fps` |
| 主线程同步构建 | 进度条只能用 **CSS keyframes**（合成器线程才跑得动） |
| TDZ | `qualityTier` 声明在 `applyQuality` 之后，移动端初始化直接抛错 |
| Python 按索引裁剪文件 | `find()` 返回 -1 没判空，把模板截断成 41KB（靠备份救回） |
| 路网空间索引用字符串键 | `i + ',' + j` 每查一次做 9 次字符串拼接 + Map 查找，74 万次调用 → 路网构建 994ms。改**整数 CSR + typed array**后 299ms |
| 顶点用 `[]` 逐点 push | 114 万顶点 × 16 次 push + 最终再拷进 Float32Array。改**两遍法预分配 typed array 直接写** |
| 分帧构建反而更慢 | roads 拆成每帧 9ms 后，路网完成时间 604ms → 3825ms，**总加载变长 2.7 倍**。分帧只适合「交互已经能用、后台补细节」，不适合关键路径 |
| **地形插值与渲染三角形不一致** | 路面/树/车用 `terrainAt`（DEM 双线性），地形却是另一套固定分辨率的三角网格（当时 220×248） → 地形从路面里顶出 1~1.4m，形成巨大灰面。必须让 `terrainAt` **逐三角形**采样同一张网格 |
| **地形网格比 DEM 还粗** | 网格 61.6m / DEM 35.2m，等于先把地形降采样再渲染：橘子洲这类窄条岸线会被量化成直角台阶。2026-10-21 已对齐到 384×432 |
| **星空用 xz 平面取格** | `floor(d.xz*420)` 的格子只约束 x/z，视线接近水平时 y 方向被拉长，一格=一根竖光柱，叠 bloom 更明显。必须在方向向量的立方体面上取格 |
| **aTag 编码是跨语言契约** | 从 `camp<<5\|func&7` 扩到 `func&31` 时，只改 Python 不改 shader，校园 solo 的 `vT*0.125` 就会把 camp 算错。两处必须同步 |
| **方向 LUT ≠ 辐照** | 拿天空 radiance 按法线方向直接查表，等于假设表面只接收那一个方向的光。真正要的是 ∫L·cosθ dω，SH9 正好是这个积分的最优低阶近似 |
| **天空色不能直接当环境光** | raw 蓝天会把所有背光面染成钢蓝；旧代码用 `lerp(white,0.42)` 去饱和，SH 里必须保留同样的处理（实测 0.30） |
| **自定义材质没有 three 的阴影** | `material.receiveShadow` 对 ShaderMaterial 无效。要么把 shadowmap chunk 拼进 shader，要么自己采样深度纹理（本项目选后者） |
| **PCF 类型拿不到原始深度** | `PCFShadowMap` 会把 depthTexture 设成 `sampler2DShadow` + compareFunction，自定义 shader 里 `texture2D(...).r` 取不到值。要原始深度必须用 `BasicShadowMap`，PCF 自己做 |
| **阴影法线偏移不能用扰动法线** | 用法线贴图扰动后的 nD 做 offset，凹凸会把采样点推进墙体，整面楼变成假阴影。必须用几何法线 |
| **Reflector 会把阴影渲两遍** | `shadowMap.autoUpdate` 默认 true，水面反射里的第二次 `render()` 会再跑一遍阴影通道。设 false + 每帧手动置 `needsUpdate` |
| **邻域投票别按面积加权** | 一个大商场（4000 m²）能压过十栋住宅，整片街区被拖成商业（商业占比虚高到 16%）。按栋数投票才符合街区纹理 |
| 建筑基座悬空 | `y0` 来自数据的 DEM，地形改成三角面后楼底会露黑缝。取轮廓内地形最低点再沉 0.25m |
| 颜色被转换两次 | `new THREE.Color(hex)` 在 ColorManagement 开启时**已做** sRGB→线性，再调 `convertSRGBToLinear()` 会暗 8 倍。树就是这样变黑的 |
| 叶片颜色叠乘 | 叶片纹理色 × 实例色 会把亮度乘两次 → 只用纹理提供明暗、实例色提供色相 |
| **全局色彩双重转换** | `C(hex)` 又调了 `convertSRGBToLinear()`。影响程度**取决于明度**：亮色（建筑 tint）只暗 20–30%，暗色（夜空/雾）暗 90%+。修完必须重排 `SKY_KEYS`，否则雾变白、远景糊死 |

---

## 5. 数据与坐标约定

- 投影原点：`originLat 28.193 / originLon 112.975`，`mPerLat 110540`、`mPerLon 98113.126`
- 世界 X = 东，Z = 南（`z = -N`）；单位米；`terrainAt(x,z)` 返回高程
- 江心 `RIVER_X ≈ -1476`；岳麓山 `x < -2000` 且 `e > 50`；橘子洲 `x ∈ [-2100,-1200]`
- 建筑高度单位分米（数据里 `/10`）；路宽 `ROAD_W=[22,19,16,13,10,7,4]`
- `aTag = camp*32 + func`：camp 2 bit（0/1/2/3），func 5 bit（0~31）。
  shader 里 `cid = floor(vT/32)`（solo 用）、`fn = mod(vT,32)`（功能）。
  **改编码时这两处必须同步**，否则校园独立视图会失效。
- 功能分类在 `_data/process.py`：`building=*` → 业态标签 → 名称关键词 → 240m 邻域投票（按栋数）→ 几何推断。
  重跑一次约 40s，会覆盖 `city.json`，需要重新 `rebuild.bat`。

---

## 6. 代码约定

- UI 文案中文；质感标签用英文大写（VIEW / PLAY / QUALITY 这类）——用户偏好
- 调试入口：`window.__dbg`（camera/scene/applyTime/ROOF/VEG/TRAFFIC/pedMesh…）
- URL 参数：`?t=2&hour=21&view=cbd|isle|ridge|all&wx=rain&q=high|mid|low`
- `qMode=auto` 时才有 FPS 自动降档；手动选档后不再被改写

---

## 7. 当前指标（2026-10-21）

| 项 | 值 |
|---|---|
| 建筑 / 树 / 车 / 行人 | 19,524 / 36.8k / 18,000 / 4.3k |
| 路网 | 114.4 万顶点 / 6400 条路 |
| 屋顶设备 | **537 万顶点**（面积 ≥180 m² 均生成，女儿墙 ≥55 m²） |
| 加载 | 约 2.4s（同步构建 772ms + 植被 + 首帧 1341ms，其中阴影约 +150ms） |
| 帧率 | 60fps（CBD / 全城 / 橘子洲三视角稳定） |
| 穿模 | 树冠 0%（36,811 棵全合规） |
| dist 冷启动传输 | 1024² 贴图，原始 3.71MB / gzip 2.54MB |
| 单文件 | 2.60MB |
| 提交三角 | 4,466,435（全城常驻，不做视锥剔除） |

### 地形高度（关键约定）

`terrainAt(x,z)` **必须与渲染地形逐三角形一致**：
- 网格 `GX=384, GZ=432`，间距 35.22m —— **与 DEM 原生分辨率一致**（2026-10-21 从 220×248 / 61.6m 改过来）
- 对角线为 **b–c**（`tx+tz<=1` 走三角形 (a,c,b)，否则 (b,c,d)）
- 原始 DEM 双线性采样只用于生成 `gridH` 顶点，不能再直接给物体定位
- 改 `GX/GZ` 会同时改变 `terrainAt` 与网格，二者仍然自洽；但所有已落位物体（路/树/车/楼基座）会平移几厘米到一米，属于预期

### 加载耗时的真实构成（2026-10-21 实测）

| 阶段 | 耗时 | 能否优化 |
|---|---|---|
| 建筑几何 | 238ms | 可（分批，但收益小） |
| 屋顶设备 | 33ms | — |
| **路网几何** | **299ms**（优化前 994ms） | 已优化到底 |
| 车流/行人/信号灯 | 143ms | 可 |
| 植被 | 83ms | 可 |
| **首帧渲染（shader 编译 + 上传）** | **957ms** | 减 program 数 / 减顶点量 |
| 加载层消失 | 2.2s | — |

---

## 8. 已知短板 / 候选下一步

1. **街景近处的树是多面体** —— 20 三角的球冠在 20–50m 处能看出棱角。方案：程序化叶片贴图 + 交叉 billboard（6–8 tri，轮廓更真实还更省）
2. **首帧 ~1.1s 的编译尖峰** —— 29 个 program 的 shader 编译 + 200MB 几何上传。这是「打开卡卡的」的主因，也是 WebGL 固有成本（Unity WebGL 同样存在）。可选：合并相似材质减 program、砍屋顶顶点量
3. 交通信号没有路口级配时（全局 26s 周期）、没有车与车的跟驰
4. 立面仍是程序化纹理，缺真实面砖/砖墙的分格与污渍
5. 夜间「滨江灯光秀」之外还缺店招实体、霓虹招牌

---

## 9. 素材授权

贴图来自 **Poly Haven**（CC0，可商用）：
`asphalt_02` / `concrete_floor_02` / `concrete_tile_facade` 及其法线。
