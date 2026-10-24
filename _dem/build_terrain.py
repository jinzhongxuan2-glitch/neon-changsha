# -*- coding: utf-8 -*-
"""抓 terrarium DEM 并生成地形栅格 terrain.json"""
import urllib.request, math, os, json, base64, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrarium import png_decode, elems
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '_data'))
import water_mask as WM

Z = 14
LON0, LON1 = 112.9125, 113.0500
LAT0, LAT1 = 28.1250, 28.2625
OLAT, OLON = 28.1930, 112.9750
MLAT, MLON = 110540.0, 111320.0 * math.cos(math.radians(OLAT))

NX, NZ = 384, 432
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_data", "out")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demtiles")
os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT, exist_ok=True)


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def get_tile(x, y):
    p = os.path.join(CACHE, f"{Z}_{x}_{y}.png")
    if os.path.exists(p) and os.path.getsize(p) > 500:
        return open(p, "rb").read()
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png"
    d = urllib.request.urlopen(url, timeout=40).read()
    open(p, "wb").write(d)
    return d


def sample(lon, lat, cache):
    n = 2 ** Z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    yf = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
    y = int(yf)
    xt = (lon + 180.0) / 360.0 * n - x
    yt = yf - y
    key = (x, y)
    if key not in cache:
        d = get_tile(x, y)
        cache[key] = png_decode(d)
    w, h, ch, pix = cache[key]
    px = min(w - 1, max(0, int(xt * w)))
    py = min(h - 1, max(0, int(yt * h)))
    return elems(pix, (py * w + px) * ch)


def main():
    cache = {}
    x0 = (LON0 - OLON) * MLON
    x1 = (LON1 - OLON) * MLON
    z0 = -(LAT1 - OLAT) * MLAT
    z1 = -(LAT0 - OLAT) * MLAT
    stepx = (x1 - x0) / (NX - 1)
    stepz = (z1 - z0) / (NZ - 1)

    grid = []
    for j in range(NZ):
        wz = z0 + j * stepz
        lat = OLAT - wz / MLAT
        row = []
        for i in range(NX):
            lon = OLON + (x0 + i * stepx) / MLON
            try:
                row.append(sample(lon, lat, cache))
            except Exception:
                row.append(0.0)
        grid.append(row)
        if j % 60 == 0:
            print(f"  row {j}/{NZ}", flush=True)

    # 5x5 中值 + 两遍高斯，压掉 SRTM 把楼顶读成地形的噪声
    def med(a):
        s = sorted(a)
        return s[len(s) // 2]
    sm = [[0.0] * NX for _ in range(NZ)]
    for j in range(NZ):
        for i in range(NX):
            nb = []
            for dj in range(-2, 3):
                for di in range(-2, 3):
                    jj, ii = j + dj, i + di
                    if 0 <= jj < NZ and 0 <= ii < NX:
                        nb.append(grid[jj][ii])
            sm[j][i] = med(nb)

    for _ in range(2):
        tmp = [row[:] for row in sm]
        for j in range(NZ):
            for i in range(NX):
                acc = 0.0; wsum = 0.0
                for dj, wi in ((-1, 1.0), (0, 2.0), (1, 1.0)):
                    for di, wj in ((-1, 1.0), (0, 2.0), (1, 1.0)):
                        jj, ii = j + dj, i + di
                        if 0 <= jj < NZ and 0 <= ii < NX:
                            acc += tmp[jj][ii] * wi * wj
                            wsum += wi * wj
                sm[j][i] = acc / wsum

    # ---- 水域压平：DEM 在江面会读到 1~4m 的噪声，不压平会被河床戳穿 ----
    try:
        parts = WM.load_rings(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_data", "rel_8727387.json"))
        outer = WM.stitch(parts.get("outer", []))
        inner = WM.stitch(parts.get("inner", []))
        wm = bytearray(NX * NZ)
        WM.rasterize(outer, NX, NZ, LON0, LON1, LAT0, LAT1, wm, 255)
        WM.rasterize(inner, NX, NZ, LON0, LON1, LAT0, LAT1, wm, 0)
        allv = sorted([v for row in sm for v in row])
        # 用低分位定基准：江面在 DEM 上被平滑抬高，取中位数会让低洼区变成"干坑"
        wl = allv[int(len(allv) * 0.03)]
        print("基准高程(3%分位):", round(wl, 2), flush=True)
        flat = 0
        for j in range(NZ):
            for i in range(NX):
                sm[j][i] -= wl
                if wm[j * NX + i]:
                    sm[j][i] = -2.0
                    flat += 1
        print("水域压平格子:", flat, flush=True)
    except Exception as e:
        print("水域压平失败:", e)

    vals = [v for r in sm for v in r]
    vals.sort()
    print("elev min/p50/p99/max:", round(vals[0], 1), round(vals[len(vals) // 2], 1),
          round(vals[int(len(vals) * 0.99)], 1), round(vals[-1], 1))

    water = 0.0
    print("参考基准：江面 = 0")

    buf = bytearray()
    for j in range(NZ):
        for i in range(NX):
            dm = int(round((sm[j][i] - water) * 10))
            dm = max(-6000, min(6000, dm))
            buf += struct.pack("<h", dm)

    payload = {
        "nx": NX, "nz": NZ,
        "x0": round(x0, 1), "z0": round(z0, 1),
        "stepx": round(stepx, 3), "stepz": round(stepz, 3),
        "water": round(water, 2),
        "data": base64.b64encode(bytes(buf)).decode(),
    }
    json.dump(payload, open(os.path.join(OUT, "terrain.json"), "w"), separators=(",", ":"))
    print("terrain.json KB:", os.path.getsize(os.path.join(OUT, "terrain.json")) // 1024)


if __name__ == "__main__":
    main()
