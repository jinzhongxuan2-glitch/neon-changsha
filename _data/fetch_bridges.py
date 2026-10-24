"""抓长沙市域内的桥梁：man_made=bridge 的轮廓 + 所有 bridge=* 的路面段（带 tags）。

用法：python _data/fetch_bridges.py
输出：_data/bridges.json
"""
import json, os, time, urllib.parse, urllib.request

ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# 与建筑/道路同一套 bbox
LAT0, LON0, LAT1, LON1 = 28.1250, 112.9125, 28.2625, 113.0500
OUT = os.path.join(os.path.dirname(__file__), "bridges.json")


def overpass(query, tag):
    last = None
    for attempt in range(3):
        for ep in ENDPOINTS:
            try:
                data = urllib.parse.urlencode({"data": query}).encode()
                req = urllib.request.Request(ep, data=data, headers={
                    "User-Agent": "Changsha3D/1.0 (academic visualisation)",
                    "Content-Type": "application/x-www-form-urlencoded",
                })
                with urllib.request.urlopen(req, timeout=300) as r:
                    body = r.read()
                if body[:1] != b"{":
                    last = body[:160]
                    continue
                return json.loads(body)
            except Exception as e:
                last = repr(e)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"{tag} failed: {last}")


def main():
    bbox = f"{LAT0:.6f},{LON0:.6f},{LAT1:.6f},{LON1:.6f}"
    q = ("[out:json][timeout:280];("
         f'way["man_made"="bridge"]({bbox});'
         f'way["bridge"]({bbox});'
         f'relation["man_made"="bridge"]({bbox});'
         ");out geom tags;")
    d = overpass(q, "bridges")
    json.dump(d, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    n = len(d.get("elements", []))
    print("bridges:", n, "->", OUT)


if __name__ == "__main__":
    main()
