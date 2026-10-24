# -*- coding: utf-8 -*-
"""把湘江 relation 的外环/内环拼成闭合环，再栅格化成遮罩 PNG"""
import json, os, math, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
LON0, LON1 = 112.9125, 113.0500
LAT0, LAT1 = 28.1250, 28.2625
W = H = 3072
EPS = 1e-7
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)


def load_rings(path):
    d = json.load(open(path, encoding="utf-8"))
    rel = d["elements"][0]
    out = {"outer": [], "inner": []}
    for m in rel.get("members", []):
        if m.get("type") != "way":
            continue
        g = m.get("geometry") or []
        pts = [(p["lon"], p["lat"]) for p in g if p]
        if len(pts) >= 2:
            out.setdefault(m.get("role") or "outer", []).append(pts)
    return out


def stitch(segs):
    segs = [list(s) for s in segs if len(s) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed:
            changed = False
            if len(cur) > 2 and abs(cur[0][0] - cur[-1][0]) < EPS and abs(cur[0][1] - cur[-1][1]) < EPS:
                break
            for i, s in enumerate(segs):
                if abs(s[0][0] - cur[-1][0]) < EPS and abs(s[0][1] - cur[-1][1]) < EPS:
                    cur += s[1:]; segs.pop(i); changed = True; break
                if abs(s[-1][0] - cur[-1][0]) < EPS and abs(s[-1][1] - cur[-1][1]) < EPS:
                    cur += list(reversed(s))[1:]; segs.pop(i); changed = True; break
                if abs(s[-1][0] - cur[0][0]) < EPS and abs(s[-1][1] - cur[0][1]) < EPS:
                    cur = s[:-1] + cur; segs.pop(i); changed = True; break
                if abs(s[0][0] - cur[0][0]) < EPS and abs(s[0][1] - cur[0][1]) < EPS:
                    cur = list(reversed(s))[:-1] + cur; segs.pop(i); changed = True; break
        if len(cur) >= 3:
            rings.append(cur)
    return rings


def rasterize(rings, w, h, x0, x1, y0, y1, buf, value):
    edges = []
    for r in rings:
        n = len(r)
        for i in range(n):
            ax, ay = r[i]
            bx, by = r[(i + 1) % n]
            if ay == by:
                continue
            if ay > by:
                ax, ay, bx, by = bx, by, ax, ay
            pax = (ax - x0) / (x1 - x0) * w
            pbx = (bx - x0) / (x1 - x0) * w
            pay = (by - y0) / (y1 - y0) * h
            pby = (ay - y0) / (y1 - y0) * h
            edges.append((pax, pbx, pay, pby, ay, by))

    for py in range(h):
        yc = y0 + (py + 0.5) / h * (y1 - y0)
        xs = []
        for (pax, pbx, pay, pby, ay, by) in edges:
            if ay <= yc < by:
                t = (yc - ay) / (by - ay)
                xs.append(pax + (pbx - pax) * t)
        if not xs:
            continue
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            xa, xb = int(round(xs[i])), int(round(xs[i + 1]))
            if xb <= xa:
                continue
            xa = max(0, xa); xb = min(w, xb)
            row = py * w
            buf[row + xa: row + xb] = bytes([value]) * (xb - xa)


def png_gray(w, h, data):
    def chunk(typ, payload):
        c = struct.pack(">I", len(payload)) + typ + payload
        c += struct.pack(">I", zlib.crc32(typ + payload) & 0xffffffff)
        return c
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += data[y * w:(y + 1) * w]
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    parts = load_rings(os.path.join(HERE, "rel_8727387.json"))
    outer = stitch(parts.get("outer", []))
    inner = stitch(parts.get("inner", []))
    print("outer rings:", len(outer), [len(r) for r in outer][:6])
    print("inner rings:", len(inner), [len(r) for r in inner][:6])

    buf = bytearray(W * H)
    rasterize(outer, W, H, LON0, LON1, LAT0, LAT1, buf, 255)
    filled1 = sum(1 for b in buf if b)
    rasterize(inner, W, H, LON0, LON1, LAT0, LAT1, buf, 0)
    filled2 = sum(1 for b in buf if b)
    print(f"water before holes {filled1/(W*H)*100:.1f}%  after {filled2/(W*H)*100:.1f}%")

    data = png_gray(W, H, buf)
    open(os.path.join(OUT, "water.png"), "wb").write(data)
    print("water.png KB:", len(data) // 1024)

    # 江水范围（用于相机与遮罩 bbox）
    xs, ys = [], []
    for r in outer:
        for (lo, la) in r:
            xs.append(lo); ys.append(la)
    print("lon range", round(min(xs), 5), round(max(xs), 5))
    print("lat range", round(min(ys), 5), round(max(ys), 5))
