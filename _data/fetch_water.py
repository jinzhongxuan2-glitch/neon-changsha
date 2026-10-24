import json, os, urllib.parse, urllib.request, time

ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
LON0, LON1 = 112.9440, 113.0060
LAT0, LAT1 = 28.1600, 28.2260
OUT = os.path.join(os.path.dirname(__file__), "water.json")


def overpass(query):
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
                    last = body[:200]
                    continue
                return json.loads(body)
            except Exception as e:
                last = repr(e)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(last)


bbox = f"{LAT0},{LON0},{LAT1},{LON1}"
q = ("[out:json][timeout:280];("
     f'way["natural"="water"]({bbox});'
     f'relation["natural"="water"]({bbox});'
     f'way["waterway"="riverbank"]({bbox});'
     f'way["place"="island"]({bbox});'
     f'relation["place"="island"]({bbox});'
     ");out geom tags;")
d = overpass(q)
json.dump(d, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
print("elements", len(d["elements"]))
for e in d["elements"][:40]:
    t = e.get("tags", {})
    print(e["type"], e["id"], len(e.get("geometry", []) or e.get("members", [])),
          t.get("natural"), t.get("name"), t.get("water"), t.get("place"))
