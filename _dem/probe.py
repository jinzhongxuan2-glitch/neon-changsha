import urllib.request, math, sys
sys.path.insert(0,'.')
from terrarium import png_decode, tile_xy, elems

Z = 15
def fetch(x,y):
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png"
    return urllib.request.urlopen(url, timeout=30).read()

def sample(lon, lat):
    x, y = tile_xy(lon, lat, Z)
    n = 2**Z
    # 瓦片内的归一化位置
    xt = (lon + 180.0) / 360.0 * n - x
    lat_r = math.radians(lat)
    yt = (1.0 - math.log(math.tan(lat_r) + 1.0/math.cos(lat_r)) / math.pi) / 2.0 * n - y
    data = fetch(x, y)
    w, h, ch, pix = png_decode(data)
    px = min(w-1, max(0, int(xt*w)))
    py = min(h-1, max(0, int(yt*h)))
    return elems(pix, (py*w+px)*ch)

pts = {
  "IFS 楼顶": (112.9757, 28.1939),
  "IFS 西侧街道": (112.9748, 28.1939),
  "湘江 江心": (112.9640, 28.1930),
  "五一广场": (112.9788, 28.1955),
  "岳麓山": (112.9400, 28.1850),
}
for k,(lo,la) in pts.items():
    try:
        print(f"{k:16s} {sample(lo,la):8.1f} m")
    except Exception as e:
        print(k, "ERR", e)
