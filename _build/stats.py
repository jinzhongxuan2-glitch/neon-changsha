# -*- coding: utf-8 -*-
"""PNG 亮度统计：用于客观记录「地面多黑、远景多糊」。

    python _build/stats.py _audit/baseline/day_cbd.png
    python _build/stats.py a.png b.png

输出：整体 mean / p50 / p95、压黑像素占比、4x3 分区平均亮度（0-255）
"""

import struct
import sys
import zlib


def load_rgb(path):
    d = open(path, "rb").read()
    pos = 8
    idat = b""
    w = h = ct = 0
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        data = d[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", data[:10])
        elif typ == b"IDAT":
            idat += data
    raw = zlib.decompress(idat)
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    o = 0
    for y in range(h):
        f = raw[o]; o += 1
        line = bytearray(raw[o:o + stride]); o += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                c = prev[i - bpp] if i >= bpp else 0
                b = prev[i]
                pa = abs(b - c); pb = abs(a - c); pc = abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bpp, out


def stats(path):
    w, h, bpp, buf = load_rgb(path)
    n = w * h
    lum = bytearray(n)
    for i in range(n):
        o = i * bpp
        if bpp >= 3:
            lum[i] = (buf[o] * 77 + buf[o + 1] * 150 + buf[o + 2] * 29) >> 8
        else:
            lum[i] = buf[o]
    s = sorted(lum)
    dark = sum(1 for v in lum if v < 16) / n * 100
    grid = []
    for gy in range(3):
        row = []
        y0, y1 = gy * h // 3, (gy + 1) * h // 3
        for gx in range(4):
            x0, x1 = gx * w // 4, (gx + 1) * w // 4
            acc = cnt = 0
            for y in range(y0, y1):
                base = y * w
                for x in range(x0, x1):
                    acc += lum[base + x]
                    cnt += 1
            row.append(acc / cnt)
        grid.append(row)
    return {
        "file": path.replace("\\", "/").split("/")[-1],
        "size": "%dx%d" % (w, h),
        "mean": sum(lum) / n,
        "p50": s[n // 2],
        "p95": s[int(n * 0.95)],
        "p99": s[int(n * 0.99)],
        "dark%": dark,
        "grid": grid,
    }


def main():
    for p in sys.argv[1:]:
        r = stats(p)
        print("%-18s %-10s mean %5.1f  p50 %3d  p95 %3d  p99 %3d  <16: %5.1f%%"
              % (r["file"], r["size"], r["mean"], r["p50"], r["p95"], r["p99"], r["dark%"]))
        for gy, row in enumerate(r["grid"]):
            print("   row%d  " % gy + "  ".join("%5.1f" % v for v in row))


if __name__ == "__main__":
    main()
