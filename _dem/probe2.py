import urllib.request, math, sys
sys.path.insert(0,'.')
from terrarium import png_decode, tile_xy, elems

Z = 14
def fetch(x,y):
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png"
    return urllib.request.urlopen(url, timeout=40).read()

# 覆盖岳麓山周边 8km 的瓦片
cen = (112.9417, 28.1778)   # 云麓峰附近
x0,y0 = tile_xy(cen[0], cen[1], Z)
mn, mx, pts = 1e9, -1e9, 0
for dx in (-1,0,1):
    for dy in (-1,0,1):
        try:
            d = fetch(x0+dx, y0+dy)
            w,h,ch,pix = png_decode(d)
            step = 8
            for py in range(0,h,step):
                for px in range(0,w,step):
                    v = elems(pix,(py*w+px)*ch); pts+=1
                    mn=min(mn,v); mx=max(mx,v)
        except Exception as e:
            print('tile err', e)
print(f'z={Z} tiles={3}x3 pts={pts} min={mn:.1f} max={mx:.1f}')
