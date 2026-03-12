def rgb_to_hsv(color):
    r = color.r / 255.0
    g = color.g / 255.0
    b = color.b / 255.0
    c_max = max(r, g, b)
    c_min = min(r, g, b)
    diff = c_max - c_min
    if c_max == c_min:
        h = 0
    elif c_max == r:
        h = (60 * ((g - b) / diff) + 360) % 360
    elif c_max == g:
        h = (60 * ((b - r) / diff) + 120) % 360
    elif c_max == b:
        h = (60 * ((r - g) / diff) + 240) % 360
    if c_max == 0:
        s = 0
    else:
        s = (diff / c_max) * 100
    v = c_max * 100
    return {
        "h": round(h, 2), 
        "s": round(s, 2), 
        "v": round(v, 2)
    }


def hsv_to_rgb(color):
    try:
        h = float(color.h)
        s = float(color.s) / 100.0
        v = float(color.v) / 100.0
    except Exception:
        raise ValueError('HSV components must be numbers')
    if not (0 <= h < 360) and not (h == 360):
        raise ValueError('Hue out of range: must be in [0,360)')
    if not (0.0 <= s <= 1.0):
        raise ValueError('Saturation out of range: 0-100')
    if not (0.0 <= v <= 1.0):
        raise ValueError('Value out of range: 0-100')

    c = v * s
    x = c * (1 - abs(((h / 60.0) % 2) - 1))
    m = v - c
    if 0 <= h < 60:
        rp, gp, bp = c, x, 0
    elif 60 <= h < 120:
        rp, gp, bp = x, c, 0
    elif 120 <= h < 180:
        rp, gp, bp = 0, c, x
    elif 180 <= h < 240:
        rp, gp, bp = 0, x, c
    elif 240 <= h < 300:
        rp, gp, bp = x, 0, c
    else:
        rp, gp, bp = c, 0, x

    r = int(round((rp + m) * 255))
    g = int(round((gp + m) * 255))
    b = int(round((bp + m) * 255))

    return {'r': r, 'g': g, 'b': b}












def rgb_to_hex(color):
    r, g, b = _validate_rgb_components(color.r, color.g, color.b)
    if color.a is not None:
        a = _normalize_alpha(color.a)
        a_int = int(round(a * 255))
        return f"#{r:02x}{g:02x}{b:02x}{a_int:02x}"
    return f"#{r:02x}{g:02x}{b:02x}"

def _validate_rgb_components(r, g, b):
    try:
        rf = float(r)
        gf = float(g)
        bf = float(b)
    except Exception:
        raise ValueError('RGB components must be numbers')
    for name, v in (('r', rf), ('g', gf), ('b', bf)):
        if not (0 <= v <= 255):
            raise ValueError(f"RGB component {name} out of range: {v}")
    return int(round(rf)), int(round(gf)), int(round(bf))

def _normalize_alpha(a):
    if a is None:
        return 1.0
    try:
        af = float(a)
    except Exception:
        raise ValueError('Alpha must be a number')
    if af > 1:
        if 0 <= af <= 255:
            af = af / 255.0
        else:
            raise ValueError(f'Alpha out of range: {af}')
    if not (0.0 <= af <= 1.0):
        raise ValueError(f'Alpha out of range: {af}')
    return af
