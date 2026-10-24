import struct, zlib, sys

def load(p):
    d = open(p,'rb').read()
    pos = 8; idat = b''; w=h=ct=0
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos+4])[0]
        typ = d[pos+4:pos+8]
        data = d[pos+8:pos+8+ln]
        pos += 12+ln
        if typ == b'IHDR':
            w,h,bd,ct = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT':
            idat += data
    raw = zlib.decompress(idat)
    bpp = {0:1,2:3,4:2,6:4}[ct]
    stride = w*bpp
    out = bytearray(h*stride)
    prev = bytearray(stride)
    o = 0
    for y in range(h):
        f = raw[o]; o += 1
        line = bytearray(raw[o:o+stride]); o += stride
        if f == 1:
            for i in range(bpp, stride): line[i] = (line[i]+line[i-bpp]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i]+prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a+prev[i])>>1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                c = prev[i-bpp] if i >= bpp else 0
                b = prev[i]
                pa = abs(b-c); pb = abs(a-c); pc = abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i]+pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, bpp, stride, out

path = sys.argv[1]
w, h, bpp, stride, px = load(path)
print('size', w, h, 'bpp', bpp)

# 16x9 粗采样亮度图
gx, gy = 32, 18
ramp = ' .:-=+*#%@'
print('   ' + ''.join(str((i*gx//32) % 10) for i in range(gx)))
for j in range(gy):
    row = ''
    for i in range(gx):
        x = int((i+0.5)/gx*w); y = int((j+0.5)/gy*h)
        k = (y*stride) + x*bpp
        r, g, b = px[k], px[k+1], px[k+2]
        lum = (r*299 + g*587 + b*114)//1000
        row += ramp[min(9, lum*10//256)]
    print('%2d ' % j + row)

# 最亮区域定位（上半屏）
best = []
for j in range(0, int(h*0.62), 6):
    for i in range(0, w, 6):
        k = (j*stride) + i*bpp
        r, g, b = px[k], px[k+1], px[k+2]
        lum = (r*299 + g*587 + b*114)//1000
        if lum > 90:
            best.append((lum, i, j, r, g, b))
best.sort(reverse=True)
print('bright count', len(best))
for t in best[:12]:
    print('  lum=%d at (%d,%d) rgb=%d,%d,%d' % t)
