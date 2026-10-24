import json, os, time, urllib.parse, urllib.request, concurrent.futures

ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# ---- 绝对瓦片网格：扩容不会让已有瓦片错位 ----
BASE_LON, BASE_LAT = 112.90, 28.10
STEP = 0.0125
I0, I1 = 1, 11      # lon: 112.9125 .. 113.0500
J0, J1 = 2, 12      # lat: 28.1250 .. 28.2625

OUT = os.path.join(os.path.dirname(__file__), "tiles")
os.makedirs(OUT, exist_ok=True)


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
         f'way["building"]({bbox});out geom tags;')
    path = os.path.join(OUT, f"b_{i:02d}_{j:02d}.json")
    if os.path.exists(path) and os.path.getsize(path) > 200:
        return "skip"
    d = overpass(q, f"b{i}_{j}")
    json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    return len(d.get("elements", []))


if __name__ == "__main__":
    jobs = [(i, j) for i in range(I0, I1 + 1) for j in range(J0, J1 + 1)]
    t0 = time.time()
    total = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(fetch, i, j): (i, j) for i, j in jobs}
        for k, f in enumerate(concurrent.futures.as_completed(futs)):
            i, j = futs[f]
            try:
                n = f.result()
                if isinstance(n, int):
                    total += n
                print(f"[{k+1}/{len(jobs)}] {i:02d},{j:02d} -> {n}  total={total}  {time.time()-t0:.0f}s", flush=True)
            except Exception as e:
                print(f"[{k+1}/{len(jobs)}] {i:02d},{j:02d} FAILED {e}", flush=True)
