import json, os, time, urllib.parse, urllib.request, concurrent.futures

ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

BASE_LON, BASE_LAT = 112.90, 28.10
STEP = 0.0125
I0, I1 = 1, 11
J0, J1 = 2, 12

OUT = os.path.join(os.path.dirname(__file__), "tiles")
ROADS = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$"


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


def fetch(i, j):
    lo0 = BASE_LON + i * STEP
    lo1 = lo0 + STEP
    la0 = BASE_LAT + j * STEP
    la1 = la0 + STEP
    bbox = f"{la0:.6f},{lo0:.6f},{la1:.6f},{lo1:.6f}"
    q = ("[out:json][timeout:280];"
         f'way["highway"~"{ROADS}"]({bbox});out geom;')
    path = os.path.join(OUT, f"r_{i:02d}_{j:02d}.json")
    if os.path.exists(path) and os.path.getsize(path) > 200:
        return "skip"
    d = overpass(q, f"r{i}_{j}")
    json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    return len(d.get("elements", []))


if __name__ == "__main__":
    jobs = [(i, j) for i in range(I0, I1 + 1) for j in range(J0, J1 + 1)]
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(fetch, i, j): (i, j) for i, j in jobs}
        for k, f in enumerate(concurrent.futures.as_completed(futs)):
            i, j = futs[f]
            try:
                print(f"[{k+1}/{len(jobs)}] r {i:02d},{j:02d} -> {f.result()}  {time.time()-t0:.0f}s", flush=True)
            except Exception as e:
                print(f"[{k+1}/{len(jobs)}] r {i:02d},{j:02d} FAILED {e}", flush=True)
