# -*- coding: utf-8 -*-
"""统计 buildings 里的 camp / func 分布，为 A2 店面几何估算量级。"""
import base64
import json
import os
import struct
import collections

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(HERE, "_data", "out", "city.json"), encoding="utf-8"))
raw = base64.b64decode(d["buildings"])
count = struct.unpack_from("<I", raw, 0)[0]
print("buildings:", count)

p = 4
camp_c = collections.Counter()
func_c = collections.Counter()
combo = collections.Counter()
h_buckets = collections.Counter()
edge_ok = 0          # 有 >=1 条 6m 以上边的楼
large = 0            # 周长 >= 30m

for i in range(count):
    h10, n, mode, base, tag = struct.unpack_from("<HBBhB", raw, p)
    p += 7
    camp = (tag >> 5) & 3
    func = tag & 31
    camp_c[camp] += 1
    func_c[func] += 1
    combo[(camp, func)] += 1
    h = h10 / 10.0
    b = ("<6" if h < 6 else "6-10" if h < 10 else "10-26" if h < 26 else "26-60" if h < 60 else ">=60")
    h_buckets[b] += 1
    pts = []
    for k in range(n):
        x, z = struct.unpack_from("<hh", raw, p)
        p += 4
        pts.append((x / 4.0, z / 4.0))
    per = 0.0
    mx = 0.0
    for k in range(n):
        a = pts[k]; b2 = pts[(k + 1) % n]
        L = ((b2[0] - a[0]) ** 2 + (b2[1] - a[1]) ** 2) ** 0.5
        per += L
        mx = max(mx, L)
    if mx >= 6:
        edge_ok += 1
    if per >= 30:
        large += 1

print("\ncamp:", dict(sorted(camp_c.items())))
print("func:", dict(sorted(func_c.items())))
print("\ncamp>0 占比: %.1f%%" % (100.0 * sum(v for k, v in camp_c.items() if k) / count))
print("有 >=6m 边:", edge_ok, " 周长>=30m:", large)

print("\nh 分布:", dict(sorted(h_buckets.items())))

print("\n(camp,func) top20:")
for k, v in combo.most_common(20):
    print("   camp=%d func=%2d : %6d  (%.1f%%)" % (k[0], k[1], v, 100.0 * v / count))

# 现在客户端把 func 截成 3 位，会把这些 func 混成同一个
print("\n[客户端 func&7 折叠后]")
fold = collections.Counter()
for (camp, func), v in combo.items():
    fold[(camp, func & 7)] += v
for k, v in sorted(fold.items(), key=lambda kv: -kv[1])[:12]:
    print("   camp=%d fn=%2d : %6d" % (k[0], k[1] * 1 + 0, v))
