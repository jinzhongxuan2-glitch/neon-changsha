# -*- coding: utf-8 -*-
"""
把 OSM 原始数据编译成引擎可直接消费的紧凑二进制。
输出：_data/out/city.json  (含 buildings / roads / meta 的 base64 缓冲)
"""
import json, os, math, struct, base64, glob, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TILES = os.path.join(HERE, "tiles")
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

# ---- 全城 bbox（与 fetch 的绝对网格一致） ----
LON0, LON1 = 112.9125, 113.0500
LAT0, LAT1 = 28.1250, 28.2625

# 投影原点固定，扩容时已有坐标不漂移
ORIGIN_LAT, ORIGIN_LON = 28.1930, 112.9750

M_PER_DEG_LAT = 110540.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))


def proj(lat, lon):
    x = (lon - ORIGIN_LON) * M_PER_DEG_LON
    z = -(lat - ORIGIN_LAT) * M_PER_DEG_LAT
    return x, z


# ---------------- 几何工具 ----------------
def ring_area(pts):
    s = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s * 0.5


def simplify(pts, tol=0.6):
    """Douglas-Peucker（闭合环按首尾同点处理）"""
    if len(pts) < 4:
        return pts
    closed = pts[0] == pts[-1]
    seq = pts[:-1] if closed else pts
    if len(seq) < 3:
        return seq

    def dp(lo, hi, keep):
        if hi <= lo + 1:
            return
        ax, ay = seq[lo]
        bx, by = seq[hi]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for k in range(lo + 1, hi):
            px, py = seq[k]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L
            if d > best:
                best, bi = d, k
        if best > tol:
            keep.add(bi)
            dp(lo, bi, keep)
            dp(bi, hi, keep)

    keep = {0, len(seq) - 1}
    dp(0, len(seq) - 1, keep)
    out = [seq[i] for i in sorted(keep)]
    return out


def rect_fill_ratio(pts):
    """粗判凹凸：用于高度估计的稳定性，不影响几何"""
    return 1.0


# ---------------- 高度模型 ----------------
LANDMARK = {
    "长沙国金中心T1": 452, "长沙国际金融中心T1": 452, "国金中心T1": 452,
    "长沙国金中心T2": 308, "长沙国际金融中心T2": 308, "国金中心T2": 308,
    "世茂环球金融中心": 347, "长沙世茂环球金融中心": 347,
    "华创国际广场": 300, "华远国际中心": 278,
    "华远华中心": 224, "北辰中信银行大厦": 235,
    "泊富国际广场": 228, "湖南日报传媒中心": 248,
    "湘江财富金融中心": 327, "富兴世界金融中心": 219,
    "海信广场": 160, "平和堂": 60, "王府井": 55,
}

TYPE_BASE = {
    "house": 7, "detached": 7, "terrace": 8, "bungalow": 5, "cabin": 5,
    "hut": 3, "shed": 3, "garage": 3, "garages": 3, "roof": 3,
    "apartments": 34, "residential": 26, "dormitory": 22,
    "retail": 14, "commercial": 26, "office": 38, "supermarket": 12,
    "hotel": 45, "hospital": 26, "school": 14, "university": 18,
    "kindergarten": 9, "church": 12, "temple": 10, "mosque": 12,
    "industrial": 11, "warehouse": 9, "factory": 10,
    "construction": 20, "civic": 20, "public": 18, "government": 22,
    "parking": 8, "train_station": 18, "transportation": 12,
    "stadium": 25, "sports_hall": 22, "museum": 16, "theatre": 18,
    "yes": 20, "": 20, None: 20,
}

IFS = (112.9757, 28.1939)  # 长沙国金中心


def parse_h(v):
    if v is None:
        return None
    s = str(v).strip().lower().replace("meters", "").replace("meter", "").replace("m", "")
    try:
        f = float(s)
        return f if 2 <= f <= 600 else None
    except Exception:
        return None


def estimate_height(tags, area, cx, cz):
    h = parse_h(tags.get("height"))
    lv = tags.get("building:levels")
    if h is None and lv:
        try:
            n = float(str(lv).split(";")[0])
            if 1 <= n <= 160:
                h = n * (3.15 if tags.get("building") in ("apartments", "residential", "dormitory") else 3.9)
        except Exception:
            pass

    name = tags.get("name") or ""
    for k, v in LANDMARK.items():
        if k in name:
            return float(v)
    if h is not None and h > 320 and ("IFS" not in name and "国金" not in name):
        h = 320.0
    if h is not None and 400 < h < 452:
        h = 348.0

    bt = (tags.get("building") or "yes").lower()
    base = TYPE_BASE.get(bt, 20)
    if h is None:
        # 占地越大越可能是塔楼；再叠加 CBD 引力
        h = base + min(28.0, math.sqrt(max(area, 0)) * 0.52)
        dist_if = math.hypot(cx - _IFS_X, cz - _IFS_Z)
        cbd = math.exp(-(dist_if * dist_if) / (620 * 620))
        h += cbd * 46 * min(1.0, area / 900.0)
        if bt in ("house", "shed", "garage", "hut", "roof", "bungalow"):
            h = min(h, 12)
    return max(3.0, min(452.0, h))


_IFS_X, _IFS_Z = proj(IFS[1], IFS[0])



# ---------------- 真实密度 + 分位映射高度模型 ----------------
import math as _m

GRID = 100.0


def _polys(v):
    return v


def build_density(verts):
    """用真实轮廓栅格化出 100m 网格的建筑覆盖率，再 3x3 平滑"""
    if not verts:
        return {}
    xs = [p[0] for r in verts for p in r]
    zs = [p[1] for r in verts for p in r]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    nx = int((x1 - x0) / GRID) + 2
    nz = int((z1 - z0) / GRID) + 2
    area = [[0.0] * nz for _ in range(nx)]
    for r in verts:
        a = abs(ring_area(r))
        cx = sum(p[0] for p in r) / len(r)
        cz = sum(p[1] for p in r) / len(r)
        ix = int((cx - x0) / GRID)
        iz = int((cz - z0) / GRID)
        if 0 <= ix < nx and 0 <= iz < nz:
            area[ix][iz] += a
    cov = [[min(1.0, area[i][j] / (GRID * GRID)) for j in range(nz)] for i in range(nx)]
    sm = [[0.0] * nz for _ in range(nx)]
    for i in range(nx):
        for j in range(nz):
            t = 0.0; c = 0
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    ii, jj = i + di, j + dj
                    if 0 <= ii < nx and 0 <= jj < nz:
                        t += cov[ii][jj]; c += 1
            sm[i][j] = t / c
    return {"x0": x0, "z0": z0, "nx": nx, "nz": nz, "cov": sm}


def sample_density(dens, cx, cz):
    if not dens:
        return 0.3
    ix = int((cx - dens["x0"]) / GRID)
    iz = int((cz - dens["z0"]) / GRID)
    if 0 <= ix < dens["nx"] and 0 <= iz < dens["nz"]:
        return dens["cov"][ix][iz]
    return 0.15


# 长沙真实楼高分布（分位 → 米），依据公开摩天楼统计校准
def quantile_height(q, n=8426):
    """长沙真实楼高分布，按"绝对栋数"校准：
       ≥300m 4 栋 / ≥200m 34 栋 / ≥150m 40 栋 / ≥100m 90 栋。
       这样无论模型覆盖多大范围，天际线结构都不漂移。"""
    q = min(max(q, 0.0), 0.99999)
    n = max(n, 400.0)
    q100 = 1.0 - 90.0 / n
    q150 = 1.0 - 40.0 / n
    q200 = 1.0 - 34.0 / n
    q300 = 1.0 - 4.0 / n

    if q < 0.600:
        return 3.0 + 19.0 * (q / 0.600)
    if q < 0.950:
        return 22.0 + 28.0 * ((q - 0.600) / 0.350)
    if q < 0.95 + (q100 - 0.95) * 0.5:
        return 50.0 + 25.0 * ((q - 0.950) / max(1e-6, (q100 - 0.95) * 0.5))
    if q < q100:
        return 75.0 + 25.0 * ((q - (0.95 + (q100 - 0.95) * 0.5)) / max(1e-6, (q100 - 0.95) * 0.5))
    if q < q150:
        return 100.0 + 50.0 * ((q - q100) / max(1e-6, q150 - q100))
    if q < q200:
        return 150.0 + 50.0 * ((q - q150) / max(1e-6, q200 - q150))
    if q < q300:
        return 200.0 + 60.0 * ((q - q200) / max(1e-6, q300 - q200))
    return 260.0 + 40.0 * min(1.0, (q - q300) / max(1e-6, 1.0 - q300))


CBD_PTS = [(1010, 190, 520), (300, -300, 420), (560, -820, 240), (1520, 980, 260)]


def cbd_score(cx, cz):
    best = 0.0
    for (px, pz, r) in CBD_PTS:
        d = _m.hypot(cx - px, cz - pz)
        best = max(best, _m.exp(-(d * d) / (r * r)))
    return best


# ---------------- GHSL 卫星建筑高度场 ----------------
_GHSL = {"arr": None, "ok": False, "tried": False}
GHSL_TIF = r"C:/Users/<user>/Desktop/neon-changsha/_dem/GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_54009_100_V1_0_R6_C29.tif"
GHSL_X0, GHSL_Y0 = 9959000.0, 4000000.0   # 瓦片左上角（Mollweide 米）
R_MOLL = 6371007.181


def _load_ghsl():
    if _GHSL["tried"]:
        return _GHSL["arr"]
    _GHSL["tried"] = True
    try:
        import tifffile
        _GHSL["arr"] = tifffile.imread(GHSL_TIF)
        _GHSL["ok"] = True
    except Exception as e:
        print("  [GHSL] 未加载（本轮改用核心区引力近似高度）:", e)
        _GHSL["arr"] = None
    return _GHSL["arr"]


def _moll_xy(lon, lat):
    phi = _m.radians(lat)
    lam = _m.radians(lon)
    th = phi
    for _ in range(15):
        d = (2 * th + _m.sin(2 * th) - _m.pi * _m.sin(phi)) / (2 + 2 * _m.cos(2 * th))
        th -= d
        if abs(d) < 1e-12:
            break
    x = 2 * _m.sqrt(2) / _m.pi * R_MOLL * lam * _m.cos(th)
    y = _m.sqrt(2) * R_MOLL * _m.sin(th)
    return x, y


def ghsl_at(x_m, z_m):
    """世界坐标 -> GHSL 100m 网格值"""
    a = _load_ghsl()
    if a is None:
        return None
    lon = ORIGIN_LON + x_m / M_PER_DEG_LON
    lat = ORIGIN_LAT - z_m / M_PER_DEG_LAT
    x, y = _moll_xy(lon, lat)
    px = int((x - GHSL_X0) / 100.0)
    py = int((GHSL_Y0 - y) / 100.0)
    if 0 <= px < a.shape[1] and 0 <= py < a.shape[0]:
        return float(a[py, px])
    return None




# ---------------- 中南大学校区 ----------------
CAMPUS = {"岳麓山": 1, "麓南": 2, "潇湘": 3}
_CAMP = {"polys": None}


def load_campus():
    if _CAMP["polys"] is not None:
        return _CAMP["polys"]
    path = os.path.join(HERE, "csu_geom.json")
    if not os.path.exists(path):
        _CAMP["polys"] = {}
        return {}
    d = json.load(open(path, encoding="utf-8"))
    out = {}
    for e in d["elements"]:
        nm = e.get("tags", {}).get("name", "")
        for k, cid in CAMPUS.items():
            if k in nm:
                out[cid] = [proj(p["lat"], p["lon"]) for p in e["geometry"]]
    _CAMP["polys"] = out
    return out


def point_in(poly, x, z):
    c = False
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            c = not c
    return c


def campus_of(x, z):
    for cid, poly in load_campus().items():
        if point_in(poly, x, z):
            return cid
    return 0


# ---------------- 建筑功能分类（写进 tag 低 5 位，0~31） ----------------
# 功能决定「长什么样」：办公=幕墙 + 整层亮灯，商业=底层强店招，住宅=阳台 + 散点暖光。
F_GENERIC, F_RESI, F_APART, F_OFFICE, F_COMMERCE, F_HOTEL, \
    F_PUBLIC, F_INDUSTRY, F_CONSTRUCT, F_HISTORIC, F_CAMPUS = range(11)

FUNC_LABEL = {0: "其他", 1: "住宅", 2: "公寓宿舍", 3: "办公", 4: "商业", 5: "酒店",
              6: "公共", 7: "工业", 8: "在建", 9: "历史宗教", 10: "校园"}

BT_FUNC = {
    "residential": F_RESI, "house": F_RESI, "detached": F_RESI, "terrace": F_RESI,
    "bungalow": F_RESI, "cabin": F_RESI, "villa": F_RESI, "farm": F_RESI,
    "apartments": F_APART, "dormitory": F_APART, "hostel": F_APART,
    "office": F_OFFICE,
    "commercial": F_COMMERCE, "retail": F_COMMERCE, "supermarket": F_COMMERCE,
    "department_store": F_COMMERCE, "kiosk": F_COMMERCE, "mall": F_COMMERCE,
    "hotel": F_HOTEL, "resort": F_HOTEL,
    "school": F_PUBLIC, "university": F_PUBLIC, "college": F_PUBLIC,
    "kindergarten": F_PUBLIC, "hospital": F_PUBLIC, "civic": F_PUBLIC,
    "public": F_PUBLIC, "government": F_PUBLIC, "museum": F_PUBLIC,
    "theatre": F_PUBLIC, "train_station": F_PUBLIC, "transportation": F_PUBLIC,
    "stadium": F_PUBLIC, "sports_hall": F_PUBLIC, "library": F_PUBLIC,
    "industrial": F_INDUSTRY, "warehouse": F_INDUSTRY, "factory": F_INDUSTRY,
    "manufacture": F_INDUSTRY,
    "construction": F_CONSTRUCT,
    "church": F_HISTORIC, "temple": F_HISTORIC, "mosque": F_HISTORIC,
    "shrine": F_HISTORIC, "chapel": F_HISTORIC,
}

AMEN_FUNC = {
    "restaurant": F_COMMERCE, "cafe": F_COMMERCE, "food_court": F_COMMERCE,
    "bank": F_COMMERCE, "marketplace": F_COMMERCE, "fuel": F_COMMERCE,
    "hospital": F_PUBLIC, "clinic": F_PUBLIC, "doctors": F_PUBLIC,
    "school": F_PUBLIC, "university": F_PUBLIC, "college": F_PUBLIC,
    "kindergarten": F_PUBLIC, "library": F_PUBLIC, "townhall": F_PUBLIC,
    "courthouse": F_PUBLIC, "police": F_PUBLIC, "fire_station": F_PUBLIC,
    "theatre": F_PUBLIC, "arts_centre": F_PUBLIC, "community_centre": F_PUBLIC,
    "place_of_worship": F_HISTORIC,
}

# 顺序即优先级：先判「更具体」的业态，再判泛化的住宅
NAME_RULES = [
    (F_HOTEL, ("酒店", "宾馆", "旅馆", "旅社", "客栈", "度假村", "大酒店")),
    (F_COMMERCE, ("商场", "商城", "购物", "百货", "超市", "批发", "商贸", "商业街",
                  "步行街", "家居", "建材", "市场")),
    (F_INDUSTRY, ("厂", "仓库", "仓储", "物流", "车间", "产业园", "工业园", "水厂",
                  "电厂", "污水", "垃圾", "搅拌站")),
    (F_PUBLIC, ("医院", "卫生院", "疾控", "保健院", "学校", "小学", "中学", "大学",
                "学院", "幼儿园", "图书馆", "博物馆", "文化馆", "体育馆", "体育场",
                "剧院", "政府", "区委", "法院", "检察院", "公安局", "派出所", "消防",
                "车站", "地铁", "展览", "纪念馆", "办事处")),
    (F_OFFICE, ("大厦", "大楼", "写字楼", "办公楼", "商务", "金融中心", "总部", "银行",
                "保险", "电信", "移动", "联通", "供电", "国际中心", "科技园", "创业园")),
    (F_APART, ("公寓", "宿舍")),
    (F_RESI, ("小区", "花园", "家园", "新村", "苑", "庭", "府", "湾", "山庄", "别墅",
              "住宅", "里")),
    (F_HISTORIC, ("寺", "庙", "教堂", "祠", "阁", "塔", "古迹", "遗址", "故居")),
]


def _classify_name(name):
    for code, keys in NAME_RULES:
        for k in keys:
            if k in name:
                return code
    return None


def classify_building(tags, camp):
    """返回功能码；判不出返回 None，交给上下文投票 / 几何推断。"""
    if camp:
        return F_CAMPUS
    bt = (tags.get("building") or "").lower()
    if bt in BT_FUNC:
        return BT_FUNC[bt]
    if tags.get("shop"):
        return F_COMMERCE
    if tags.get("office"):
        return F_PUBLIC if tags.get("office") == "government" else F_OFFICE
    am = tags.get("amenity")
    if am in AMEN_FUNC:
        return AMEN_FUNC[am]
    tou = tags.get("tourism")
    if tou == "hotel":
        return F_HOTEL
    if tou in ("museum", "gallery", "attraction"):
        return F_PUBLIC
    if tags.get("healthcare"):
        return F_PUBLIC
    if tags.get("historic"):
        return F_HISTORIC
    nm = tags.get("name") or ""
    if nm:
        f = _classify_name(nm)
        if f is not None:
            return f
    return None


def guess_by_geom(r):
    """没标签也没名字：按最终高度 + 占地 + CBD 引力推断。
       核心区里「低矮小楼」也是临街商铺，这是老城区与 CBD 观感差异的来源。"""
    h, a = r["hf"], r["area"]
    core = cbd_score(r["cx"], r["cz"])
    rnd = r["sid"] % 100
    if h >= 180:
        return F_OFFICE
    if core > 0.62:
        if h >= 45:
            return F_OFFICE if rnd < 62 else F_COMMERCE
        if h >= 16:
            return F_COMMERCE if a >= 320 else F_APART
        return F_COMMERCE if a >= 180 else F_APART
    if core > 0.40:
        if h >= 90:
            return F_OFFICE if rnd < 55 else F_APART
        if h >= 30:
            return F_APART if rnd < 55 else F_COMMERCE
        if a >= 900:
            return F_COMMERCE
        return F_RESI if h >= 12 else F_GENERIC
    if h >= 90:
        return F_APART
    if h >= 33:
        return F_APART
    if a >= 2500:
        return F_COMMERCE
    if h >= 12:
        return F_RESI
    return F_GENERIC


def resolve_functions(rec, cell=200.0):
    """上下文投票：看 200m 邻域里已标注建筑的**栋数**构成（不按面积加权，
       否则一个商场能把整片住宅拖成商业）。多数派要占到 48% 才采纳，否则退回几何推断。"""
    acc = {}
    for r in rec:
        f = r["func"]
        if f is None or f == F_CAMPUS:
            continue
        k = (int(r["cx"] // cell), int(r["cz"] // cell))
        d = acc.setdefault(k, {})
        d[f] = d.get(f, 0) + 1
    n_ctx = n_geom = 0
    for r in rec:
        if r["func"] is not None:
            if not r.get("fhow"):
                r["fhow"] = "tag"
            continue
        i, j = int(r["cx"] // cell), int(r["cz"] // cell)
        tot = {}
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for f, c in acc.get((i + di, j + dj), {}).items():
                    tot[f] = tot.get(f, 0) + c
        ctx_f = None
        if tot:
            f, c = max(tot.items(), key=lambda kv: kv[1])
            s = sum(tot.values())
            if c >= 4 and c >= 0.48 * s:
                ctx_f = f
        g = guess_by_geom(r)
        core = cbd_score(r["cx"], r["cz"])
        # 邻居都说住宅、但这里在 CBD 核心且几何特征像办公/商业 -> 相信几何
        if ctx_f is not None:
            if core > 0.55 and ctx_f in (F_RESI, F_APART) and g in (F_OFFICE, F_COMMERCE):
                r["func"] = g
                r["fhow"] = "geom"
                n_geom += 1
            else:
                r["func"] = ctx_f
                r["fhow"] = "ctx"
                n_ctx += 1
        else:
            r["func"] = g
            r["fhow"] = "geom"
            n_geom += 1

    # 高度校正：200m 以上的超高层几乎不可能是酒店/商场；上下文投票给的也要改回办公
    for r in rec:
        if r["func"] in (F_RESI, F_APART) and r["hf"] >= 200:
            r["func"] = F_OFFICE
        elif r["func"] in (F_RESI, F_APART) and r["hf"] >= 120 and cbd_score(r["cx"], r["cz"]) > 0.62:
            r["func"] = F_OFFICE
        elif r["func"] in (F_HOTEL, F_COMMERCE) and r["hf"] >= 200 and r["fhow"] in ("ctx", "geom"):
            r["func"] = F_OFFICE
    return n_ctx, n_geom


# ---------------- 校园地物（球场/草坪/水体） ----------------
AREA_KIND = {"soccer": 1, "basketball": 2, "tennis": 3, "track": 4, "grass": 5, "park": 6, "water": 7}


def build_areas():
    path = os.path.join(HERE, "csu_areas.json")
    if not os.path.exists(path):
        return []
    d = json.load(open(path, encoding="utf-8"))
    out = []
    for e in d["elements"]:
        t = e.get("tags", {})
        g = e.get("geometry") or []
        if len(g) < 3:
            continue
        kind = 0
        if t.get("natural") == "water":
            kind = AREA_KIND["water"]
        elif t.get("leisure") == "track":
            kind = AREA_KIND["track"]
        elif t.get("leisure") == "pitch":
            kind = AREA_KIND.get(t.get("sport", ""), 2)
        elif t.get("landuse") == "grass":
            kind = AREA_KIND["grass"]
        elif t.get("leisure") == "park":
            kind = AREA_KIND["park"]
        if not kind:
            continue
        pts = [proj(p["lat"], p["lon"]) for p in g]
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        if not campus_of(cx, cz):
            continue
        simp = simplify(pts, 1.0)
        if len(simp) < 3 or len(simp) > 60:
            continue
        out.append((kind, simp))
    return out


def pack_areas(areas):
    buf = bytearray()
    buf += struct.pack("<I", len(areas))
    for kind, pts in areas:
        buf += struct.pack("<BH", kind, len(pts))
        for (x, z) in pts:
            buf += struct.pack("<hh", _q16(x * 4), _q16(z * 4))
    return bytes(buf)


# ---------------- 地形 ----------------
_TERR = {"ok": False}


def load_terrain():
    if _TERR["ok"]:
        return _TERR
    path = os.path.join(OUT, "terrain.json")
    if not os.path.exists(path):
        print("  [地形] 未找到 terrain.json，全部按 0 处理")
        return None
    d = json.load(open(path, encoding="utf-8"))
    raw = base64.b64decode(d["data"])
    _TERR.update({
        "ok": True, "nx": d["nx"], "nz": d["nz"],
        "x0": d["x0"], "z0": d["z0"], "stepx": d["stepx"], "stepz": d["stepz"],
        "arr": struct.unpack("<%dh" % (d["nx"] * d["nz"]), raw),
        "water": d["water"],
    })
    return _TERR


def terrain_at(x, z):
    T = load_terrain()
    if not T:
        return 0.0
    fx = (x - T["x0"]) / T["stepx"]
    fz = (z - T["z0"]) / T["stepz"]
    i = int(math.floor(fx)); j = int(math.floor(fz))
    if i < 0 or j < 0 or i >= T["nx"] - 1 or j >= T["nz"] - 1:
        return 0.0
    tx = fx - i; tz = fz - j
    a = T["arr"][j * T["nx"] + i]
    b = T["arr"][j * T["nx"] + i + 1]
    c = T["arr"][(j + 1) * T["nx"] + i]
    d2 = T["arr"][(j + 1) * T["nx"] + i + 1]
    v = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d2 * tx) * tz
    return v / 10.0


# ---------------- 立面体系 ----------------
ST_RESI, ST_GLASS, ST_RIBBON, ST_STONE, ST_BRICK, ST_RETAIL = 0, 1, 2, 3, 4, 5
ST_MEDIA, ST_TOWER = 10, 11


def facade_style(func, bt, h, area, cx, cz, sid=0):
    """功能优先、几何其次：同一功能的楼共享一套立面语言，高度/占地决定档位。
       这样 CBD 的写字楼才会是幕墙，老城的住宅才会是阳台 + 小窗。"""
    riverfront = (-520 < cx < 160) and abs(cz) < 2600

    if h >= 250:
        return ST_TOWER
    if riverfront and h > 55 and bt not in ("house", "shed", "garage", "hut", "roof") \
            and func not in (F_INDUSTRY, F_CONSTRUCT, F_HISTORIC):
        return ST_MEDIA

    if func == F_OFFICE:
        return ST_GLASS if h >= 55 else ST_RIBBON
    if func == F_COMMERCE:
        if area > 3000 or bt in ("retail", "supermarket", "department_store", "mall", "commercial"):
            return ST_RETAIL
        if h >= 55:
            return ST_GLASS
        return ST_RETAIL if h < 24 else ST_RIBBON
    if func == F_HOTEL:
        return ST_GLASS if h >= 55 else ST_RIBBON
    if func == F_APART:
        return ST_GLASS if h >= 120 else (ST_RESI if h >= 12 else ST_BRICK)
    if func == F_RESI:
        if h < 10:
            return ST_BRICK
        # 同一类住宅也要有年代差异：72% 现代阳台楼 / 20% 老砖楼 / 8% 板式
        r = sid % 100
        return ST_RESI if r < 72 else (ST_BRICK if r < 92 else ST_RIBBON)
    if func == F_PUBLIC:
        return ST_BRICK if h < 12 else ST_RIBBON
    if func == F_INDUSTRY:
        return ST_STONE
    if func == F_CONSTRUCT:
        return ST_RIBBON
    if func == F_HISTORIC:
        return ST_BRICK

    # ---- 仍未分类：按最终高度带做混合分配 ----
    r = sid % 100
    if area > 3200 and h < 60:
        return ST_RETAIL
    if h >= 150:
        return ST_GLASS
    if h >= 90:
        return ST_GLASS if area > 700 else ST_RIBBON
    if h >= 50:
        return ST_RIBBON if r < 55 else (ST_GLASS if r < 85 else ST_RESI)
    if h >= 26:
        return ST_RESI if r < 55 else (ST_RIBBON if r < 85 else ST_GLASS)
    if h >= 12:
        return ST_RESI if r < 68 else (ST_RIBBON if r < 86 else ST_BRICK)
    return ST_BRICK if r < 60 else ST_RESI


# ---------------- 读建筑 ----------------
def load_buildings():
    seen = {}
    for path in sorted(glob.glob(os.path.join(TILES, "b_*.json"))):
        try:
            d = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        for e in d.get("elements", []):
            if e.get("type") != "way":
                continue
            g = e.get("geometry") or []
            if len(g) < 3:
                continue
            seen[e["id"]] = e
    return list(seen.values())


def _named_landmark(name):
    return any(k in name for k in LANDMARK)


def build_buildings():
    rec = []
    ways = load_buildings()
    verts = []   # flat list of (x,z)
    meta = []    # (height, nverts, mode)
    names = []

    ifs_flags = []

    for e in ways:
        g = e.get("geometry") or []
        pts = []
        for p in g:
            if p is None:
                continue
            pts.append(proj(p["lat"], p["lon"]))
        if len(pts) < 3:
            continue
        # 去重相邻点
        clean = [pts[0]]
        for p in pts[1:]:
            if abs(p[0] - clean[-1][0]) > 0.05 or abs(p[1] - clean[-1][1]) > 0.05:
                clean.append(p)
        if len(clean) > 3 and abs(clean[0][0] - clean[-1][0]) < 0.05 and abs(clean[0][1] - clean[-1][1]) < 0.05:
            clean.pop()

        # 统一为逆时针
        a = ring_area(clean)
        if a < 0:
            clean.reverse()
        area = abs(a)
        if area < 22:
            continue

        simp = simplify(clean, 0.7)
        if len(simp) < 3 or len(simp) > 40:
            continue

        cx = sum(p[0] for p in simp) / len(simp)
        cz = sum(p[1] for p in simp) / len(simp)
        tags = e.get("tags", {})
        h = estimate_height(tags, area, cx, cz)
        tagged = ("height" in tags) or ("building:levels" in tags) or _named_landmark(tags.get("name") or "")
        nm = tags.get("name") or ""
        cid = campus_of(cx, cz)
        rec.append({"idx": len(verts), "cx": cx, "cz": cz, "area": area, "h": h,
                    "tagged": tagged, "bt": (tags.get("building") or "yes").lower(),
                    "sid": e.get("id", 0), "camp": cid,
                    "func": classify_building(tags, cid), "name": nm,
                    "fhow": None})

        mode = 0  # 立面在高度定稿后统一判定

        verts.append(simp)
        meta.append((h, len(simp), mode))
        names.append(tags.get("name") or "")

    # ---- 未标注建筑：按真实密度 + CBD 打分，再做分位映射 ----
    dens = build_density(verts)
    free = [r for r in rec if not r["tagged"]]
    gvals = []
    for r in free:
        cov = sample_density(dens, r["cx"], r["cz"])
        g = ghsl_at(r["cx"], r["cz"])
        r["cov"] = cov
        r["g"] = g if g is not None else 0.0
        gvals.append(r["g"])
    gmax = max(gvals) if gvals else 1.0
    gmax = gmax if gmax > 0.5 else 1.0
    for r in free:
        la = _m.log(max(r["area"], 20.0) / 80.0)
        gn = min(1.0, (r["g"] / max(gmax * 0.75, 1.0)) ** 0.8)
        # 微小抖动：避免同一 GHSL 网格内多栋楼排成一条高度
        jit = (abs(_m.sin(r["cx"] * 12.9898 + r["cz"] * 78.233)) * 43758.5453) % 1.0
        # GHSL 卫星场为主，叠加离核心区的合理衰减，避免远郊出现假超高层
        core = cbd_score(r["cx"], r["cz"])
        if _GHSL["ok"] and gmax > 0.5:
            spatial = 0.50 * gn * (0.15 + 0.85 * core)
        else:
            # 无卫星场时退化为核心区引力，保证塔楼仍聚在 CBD
            spatial = 0.46 * core
        r["score"] = (spatial
                      + 0.28 * min(1.0, max(0.0, (la + 1.0) / 4.0))
                      + 0.20 * (0.55 - min(0.55, r["cov"])) + 0.018 * jit)
    free.sort(key=lambda r: r["score"])
    nf = len(free)
    for i, r in enumerate(free):
        q = (i + 0.5) / max(nf, 1)
        h = quantile_height(q, nf)
        # 低矮构筑物（棚、车库）硬性封顶
        if r["bt"] in ("shed", "garage", "garages", "hut", "roof", "bungalow", "cabin"):
            h = min(h, 9.0)
        elif r["bt"] in ("house", "detached", "terrace"):
            h = min(h, 18.0)
        meta[r["idx"]] = (h, meta[r["idx"]][1], meta[r["idx"]][2])

    # ---- 功能分类：标签判不出的，用 240m 邻域投票，再退回几何推断 ----
    for r in rec:
        r["hf"] = meta[r["idx"]][0]
    n_ctx, n_geom = resolve_functions(rec)

    # ---- 高度定稿后再判立面，保证用的是最终高度 ----
    for r in rec:
        hf = r["hf"]
        r["mode"] = 6 if r["camp"] else facade_style(r["func"], r["bt"], hf, r["area"], r["cx"], r["cz"], r["sid"])
        meta[r["idx"]] = (meta[r["idx"]][0], meta[r["idx"]][1], r["mode"])
    print("function resolve: ctx %d / geom %d" % (n_ctx, n_geom))

    # ---- 基底高程 ----
    bases = []
    for r in rec:
        b = terrain_at(r["cx"], r["cz"])
        bases.append(max(0.0, b))
    # rec 与 verts 是一一对应的插入顺序
    return verts, meta, names, bases, rec


# ---------------- 编码 ----------------
def pack_buildings(verts, meta, bases, rec):
    buf = bytearray()
    buf += struct.pack("<I", len(meta))
    for idx, (pts, (h, n, mode)) in enumerate(zip(verts, meta)):
        base = int(round(bases[idx] * 10))
        base = max(-6000, min(6000, base))
        r = rec[idx]
        tag = ((r["camp"] & 3) << 5) | (r["func"] & 31)
        buf += struct.pack("<HBBhB", int(round(h * 10)), n, mode, base, tag)
        for (x, z) in pts:
            buf += struct.pack("<hh", _q16(x * 4), _q16(z * 4))
    return bytes(buf)


def _q16(v):
    return int(max(-32760, min(32760, round(v))))


def load_roads():
    seen = {}
    for path in sorted(glob.glob(os.path.join(TILES, "r_*.json"))):
        try:
            d = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        for e in d.get("elements", []):
            if e.get("type") != "way" or not e.get("geometry"):
                continue
            seen[e["id"]] = e
    return list(seen.values())


ROAD_CLASS = {
    "motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4,
    "unclassified": 5, "residential": 5, "living_street": 6, "pedestrian": 6,
}


def build_roads():
    out = []
    for e in load_roads():
        t = e.get("tags", {})
        cls = ROAD_CLASS.get(t.get("highway"))
        if cls is None:
            continue
        pts = []
        for p in e["geometry"]:
            if p is None:
                continue
            pts.append(proj(p["lat"], p["lon"]))
        if len(pts) < 2:
            continue
        simp = simplify(pts, 1.2)
        if len(simp) < 2:
            continue
        if len(simp) > 80:
            simp = simp[:80]
        out.append((cls, simp))
    return out


# ---------------- 桥（阶段 2） ----------------
# OSM 只有桥面中心线和 man_made=bridge 的粗轮廓，没有塔/拱/索，
# 所以这里只负责「把真实走位与长度拉出来」，上部结构由前端参数化生成。
BRIDGE_ORDER = ["橘子洲大桥", "银盆岭大桥", "福元路大桥", "猴子石大桥"]
BRIDGE_ID = {"橘子洲大桥": "juzizhou", "银盆岭大桥": "yinpenling",
             "福元路大桥": "fuyuanlu", "猴子石大桥": "houzishi"}


def _resample(pts, n):
    """按弧长等距重采样"""
    if len(pts) < 2:
        return pts
    seg = []
    total = 0.0
    for i in range(len(pts) - 1):
        d = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        seg.append(d)
        total += d
    if total <= 0:
        return [pts[0]] * n
    out = []
    for k in range(n):
        target = total * k / (n - 1)
        acc = 0.0
        for i, d in enumerate(seg):
            if acc + d >= target or i == len(seg) - 1:
                t = 0.0 if d <= 1e-9 else (target - acc) / d
                out.append((pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
                            pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t))
                break
            acc += d
    return out


def build_bridges():
    path = os.path.join(HERE, "bridges.json")
    if not os.path.exists(path):
        print("  [桥] 未找到 bridges.json")
        return []
    d = json.load(open(path, encoding="utf-8"))
    by_name = {}
    for e in d.get("elements", []):
        t = e.get("tags") or {}
        nm = t.get("name")
        if nm not in BRIDGE_ID or t.get("bridge") != "yes":
            continue
        g = e.get("geometry") or []
        pts = [proj(p["lat"], p["lon"]) for p in g if p]
        if len(pts) < 2:
            continue
        by_name.setdefault(nm, []).append((t.get("lanes"), pts))

    out = []
    for nm in BRIDGE_ORDER:
        ways = by_name.get(nm)
        if not ways:
            continue
        lanes = 2
        for L, _ in ways:
            try:
                lanes = max(lanes, int(L))
            except (TypeError, ValueError):
                pass
        # 福元路一类的桥还带着几段 169m 的连接匝道，先按长度排序，只取最长的一对
        def _plen(pts):
            return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
                       for i in range(len(pts) - 1))
        ways.sort(key=lambda w: -_plen(w[1]))
        if len(ways) >= 2 and _plen(ways[1][1]) > 0.6 * _plen(ways[0][1]):
            # 双幅桥：按弧长重采样后取中线
            a = _resample(ways[0][1], 24)
            b = _resample(ways[1][1], 24)
            if (a[0][0] - b[0][0]) ** 2 + (a[0][1] - b[0][1]) ** 2 > \
               (a[0][0] - b[-1][0]) ** 2 + (a[0][1] - b[-1][1]) ** 2:
                b.reverse()
            mid = [((a[i][0] + b[i][0]) * 0.5, (a[i][1] + b[i][1]) * 0.5) for i in range(len(a))]
            gap = sum(math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]) for i in range(len(a))) / len(a)
        else:
            mid = _resample(ways[0][1], 24)
            gap = 0.0
        length = sum(math.hypot(mid[i + 1][0] - mid[i][0], mid[i + 1][1] - mid[i][1])
                     for i in range(len(mid) - 1))
        out.append({"id": BRIDGE_ID[nm], "name": nm, "lanes": lanes,
                    "gap": round(gap, 1), "len": round(length, 1),
                    "pts": [[round(x, 1), round(z, 1)] for x, z in mid]})
    return out


def pack_bridges(bridges):
    buf = bytearray()
    buf += struct.pack("<I", len(bridges))
    for b in bridges:
        name = b["id"].encode("utf-8")
        buf += struct.pack("<BBH", len(name), b["lanes"] & 255, len(b["pts"]))
        buf += name
        for (x, z) in b["pts"]:
            buf += struct.pack("<hh", _q16(x * 4), _q16(z * 4))
    return bytes(buf)


def pack_roads(roads):
    buf = bytearray()
    buf += struct.pack("<I", len(roads))
    for cls, pts in roads:
        buf += struct.pack("<BH", cls, len(pts))
        for (x, z) in pts:
            buf += struct.pack("<hh", _q16(x * 4), _q16(z * 4))
    return bytes(buf)


if __name__ == "__main__":
    print("loading buildings...")
    v, m, names, bases, rec = build_buildings()
    print("buildings:", len(m))
    bs = sorted(bases)
    print("base elevation p10/p50/p90/max:", round(bs[len(bs)//10],1), round(bs[len(bs)//2],1), round(bs[int(len(bs)*0.9)],1), round(bs[-1],1))
    hs = [x[0] for x in m]
    hs.sort()
    print("height p50/p90/p99/max:", round(hs[len(hs)//2],1), round(hs[int(len(hs)*0.9)],1), round(hs[int(len(hs)*0.99)],1), round(hs[-1],1))
    buckets = [(0,10),(10,22),(22,50),(50,100),(100,150),(150,200),(200,300),(300,999)]
    print("distribution:", " | ".join(f"{a}-{b}m:{sum(1 for x in hs if a<=x<b)}" for a,b in buckets))

    fc = {}
    for r in rec:
        fc[r["func"]] = fc.get(r["func"], 0) + 1
    tot = max(1, len(rec))
    print("functions:", " | ".join("%s %d(%.1f%%)" % (FUNC_LABEL.get(k, k), v, v * 100.0 / tot)
                                    for k, v in sorted(fc.items(), key=lambda kv: -kv[1])))
    print("class detail (n / area p50 / height p50 / 来源):")
    for k in sorted(fc, key=lambda x: -fc[x]):
        ar = sorted(r["area"] for r in rec if r["func"] == k)
        hh = sorted(r["hf"] for r in rec if r["func"] == k)
        how = {}
        for r in rec:
            if r["func"] == k:
                how[r["fhow"]] = how.get(r["fhow"], 0) + 1
        print("   %-6s %5d  %6.0f m2  %5.1f m   %s" % (
            FUNC_LABEL.get(k, k), fc[k], ar[len(ar) // 2], hh[len(hh) // 2],
            " ".join("%s:%d" % (a, b) for a, b in sorted(how.items(), key=lambda kv: -kv[1]))))
    tall = sorted(range(len(m)), key=lambda i: -m[i][0])[:12]
    print("tall audit:")
    for i in tall:
        print("   %5.0fm  %-24s %s" % (m[i][0], (names[i] or "-")[:24], FUNC_LABEL.get(rec[i]["func"], "?")))

    camp_n = {}
    for r in rec:
        if r["camp"]:
            camp_n[r["camp"]] = camp_n.get(r["camp"], 0) + 1
    print("campus buildings:", {k: v for k, v in sorted(camp_n.items())})

    print("loading campus areas...")
    areas = build_areas()
    print("areas:", len(areas))

    print("loading roads...")
    roads = build_roads()
    print("roads:", len(roads))

    print("loading bridges...")
    bridges = build_bridges()
    for b in bridges:
        print("  %-8s %-14s lanes=%d gap=%.1f len=%.0f  %s -> %s" % (
            b["id"], b["name"], b["lanes"], b["gap"], b["len"],
            tuple(int(v) for v in b["pts"][0]), tuple(int(v) for v in b["pts"][-1])))

    bb = pack_buildings(v, m, bases, rec)
    rb = pack_roads(roads)
    bridges_bin = pack_bridges(bridges)
    print("buildings bin:", len(bb) // 1024, "KB | roads bin:", len(rb) // 1024, "KB")

    terr = load_terrain()
    ab = pack_areas(areas)
    payload = {
        "areas": base64.b64encode(ab).decode(),
        "terrain": ({
            "nx": terr["nx"], "nz": terr["nz"], "x0": terr["x0"], "z0": terr["z0"],
            "stepx": terr["stepx"], "stepz": terr["stepz"], "data": json.load(open(os.path.join(OUT, "terrain.json"), encoding="utf-8"))["data"],
        } if terr else None),
        "meta": {
            "originLat": ORIGIN_LAT, "originLon": ORIGIN_LON,
            "mPerLat": M_PER_DEG_LAT, "mPerLon": M_PER_DEG_LON,
            "bbox": [LAT0, LON0, LAT1, LON1],
            "buildings": len(m), "roads": len(roads),
        },
        "buildings": base64.b64encode(bb).decode(),
        "areaCount": len(areas),
        "roads": base64.b64encode(rb).decode(),
        "bridges": base64.b64encode(bridges_bin).decode(),
        "bridgeCount": len(bridges),
    }
    # 顺带导出 TOP 40 高楼，便于核对地标
    top = sorted(
        [{"h": m[i][0], "name": names[i], "x": round(sum(p[0] for p in v[i]) / len(v[i]), 1),
          "z": round(sum(p[1] for p in v[i]) / len(v[i]), 1)} for i in range(len(m))],
        key=lambda d: -d["h"])[:40]

    json.dump(payload, open(os.path.join(OUT, "city.json"), "w", encoding="utf-8"))
    json.dump(top, open(os.path.join(OUT, "top.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("payload MB:", round(len(json.dumps(payload)) / 1048576, 2))
    for t in top[:15]:
        print(f"  {t['h']:6.1f}m  {t['name'][:26]:<28} ({t['x']:.0f},{t['z']:.0f})")
