#!/usr/bin/env python3
"""Build Starhop's data files from d3-celestial (BSD-3) and city-timezones (MIT).

Coordinates come out as J2000 right ascension and declination in degrees (RA 0..360).

    mkdir -p tools/src && cd tools/src
    npm pack d3-celestial@0.7.35 city-timezones@1.3.4
    for f in *.tgz; do mkdir -p "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done
    cd ../.. && python3 tools/build_data.py
"""
import json, math, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
D = HERE / 'src/d3-celestial-0.7.35/package/data'
CITIES = HERE / 'src/city-timezones-1.3.4/package/data/cityMap.json'
OUT = HERE.parent / 'data'
OUT.mkdir(exist_ok=True)


def ra_of(lon):
    return lon + 360 if lon < 0 else lon


def r(x, n=2):
    return round(float(x), n)


def dump(name, obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    (OUT / name).write_text(s, encoding='utf-8')
    print(f'{name}: {len(s) / 1024:.0f} KB')


# ---------- stars ----------
stars = json.load(open(D / 'stars.6.json'))['features']
names = json.load(open(D / 'starnames.json'))
rows = []
for f in stars:
    p = f['properties']
    lon, lat = f['geometry']['coordinates']
    bv = p.get('bv')
    try:
        bv = r(bv)
    except (TypeError, ValueError):
        bv = None
    rows.append((float(p['mag']), f['id'], r(ra_of(lon)), r(lat), bv))
rows.sort()
flat, idx_of_hip, labels = [], {}, {}
for i, (mag, hip, ra, dec, bv) in enumerate(rows):
    flat += [ra, dec, r(mag), bv if bv is not None else 0.6]
    idx_of_hip[str(hip)] = i
    n = names.get(str(hip))
    if not n:
        continue
    proper = n.get('name') or ''
    bayer = n.get('bayer') or ''
    flam = n.get('flam') or ''
    con = n.get('c') or ''
    if proper or (bayer and mag <= 4.5) or (flam and mag <= 4.0):
        labels[i] = [proper, (bayer or flam) + (' ' + con if con else '') if (bayer or flam) else '', con]
dump('stars.json', {'s': flat, 'n': labels})

# ---------- famous double stars, found by designation ----------
def find(bayer=None, flam=None, con=None, proper=None):
    for hip, n in names.items():
        if con and n.get('c') != con:
            continue
        if proper and n.get('name') == proper:
            return hip
        if bayer and n.get('bayer') == bayer:
            return hip
        if flam and n.get('flam') == flam:
            return hip
    return None

DOUBLES = [
    # key, name, lookup, separation ("), mags, note
    ('albireo', 'Albireo', dict(bayer='β1', con='Cyg'), 34, '3.1 + 5.1', 'The showpiece double: a gold star and a blue one side by side. Splits at the lowest power.'),
    ('mizar', 'Mizar and Alcor', dict(bayer='ζ', con='UMa'), 14, '2.2 + 3.9', 'Alcor sits beside Mizar to the naked eye; the telescope splits Mizar itself into two white stars.'),
    ('epslyr', 'Epsilon Lyrae', dict(bayer='ε1', con='Lyr'), 208, '4.7 + 4.6', 'The Double Double. A wide pair at low power; at 100× or more each star splits again (about 2.3″ apart).'),
    ('almach', 'Almach', dict(bayer='γ1', con='And'), 10, '2.3 + 5.0', 'An orange star with a small blue companion, like a fainter Albireo.'),
    ('castor', 'Castor', dict(bayer='α', con='Gem'), 5, '1.9 + 3.0', 'Two bright white stars close together; needs about 100×.'),
    ('corcaroli', 'Cor Caroli', dict(bayer='α2', con='CVn'), 19, '2.9 + 5.6', 'An easy pair, white with a faintly tinted companion.'),
    ('polaris', 'Polaris', dict(bayer='α', con='UMi'), 18, '2.0 + 8.7', 'The North Star has a faint companion close by; a nice test for a small telescope.'),
    ('rigel', 'Rigel', dict(bayer='β', con='Ori'), 9, '0.1 + 6.8', 'A tiny companion almost lost in Rigel’s glare; wait for steady air.'),
    ('mesarthim', 'Mesarthim', dict(bayer='γ1', con='Ari'), 7, '4.5 + 4.6', 'Two matched white stars, like a pair of headlights.'),
    ('izar', 'Izar', dict(bayer='ε', con='Boo'), 3, '2.6 + 4.8', 'A close orange and blue-green pair; needs steady air and high power.'),
    ('61cyg', '61 Cygni', dict(flam='61', con='Cyg'), 31, '5.2 + 6.0', 'Two orange dwarfs, among the nearest stars to the Sun.'),
    ('algieba', 'Algieba', dict(bayer='γ1', con='Leo'), 5, '2.4 + 3.6', 'A close pair of golden stars.'),
    ('acrux', 'Acrux', dict(bayer='α1', con='Cru'), 4, '1.3 + 1.7', 'The brightest star of the Southern Cross splits into two blue-white stars.'),
]
doubles = []
for key, nm, look, sep, mags, note in DOUBLES:
    hip = find(**look)
    if hip is None:
        # Some catalogs list the pair under the unnumbered letter.
        l2 = dict(look)
        if 'bayer' in l2:
            l2['bayer'] = l2['bayer'].rstrip('12')
        hip = find(**l2)
    i = idx_of_hip.get(str(hip)) if hip else None
    if i is None:
        sys.exit(f'double {nm}: star not found ({look})')
    ra, dec = flat[i * 4], flat[i * 4 + 1]
    doubles.append({'id': key, 'name': nm, 'type': 'ds', 'ra': ra, 'dec': dec, 'mag': flat[i * 4 + 2], 'sep': sep, 'mags': mags, 'note': note, 'star': i})
    print(f'  double {nm}: HIP {hip} mag {flat[i*4+2]}')

# ---------- constellations ----------
cons = json.load(open(D / 'constellations.json'))['features']
lines = {f['id']: f['geometry']['coordinates'] for f in json.load(open(D / 'constellations.lines.json'))['features']}
out = []
for f in cons:
    p = f['properties']
    lon, lat = f['geometry']['coordinates']
    ls = [[[r(ra_of(a)), r(b)] for a, b in seg] for seg in lines.get(f['id'], [])]
    out.append({'a': p['desig'], 'n': p['name'], 'g': p.get('gen', ''), 'rk': int(p.get('rank', 3)), 'l': [r(ra_of(lon)), r(lat)], 'ls': ls})
dump('constellations.json', out)

# ---------- deep sky ----------
TYPE = {'gc': 'Globular cluster', 'oc': 'Open cluster', 's': 'Spiral galaxy', 's0': 'Lenticular galaxy', 'sd': 'Dwarf galaxy',
        'e': 'Elliptical galaxy', 'i': 'Irregular galaxy', 'sfr': 'Nebula', 'en': 'Nebula', 'rn': 'Reflection nebula', 'bn': 'Nebula',
        'pn': 'Planetary nebula', 'snr': 'Supernova remnant', 'pos': 'Star field'}
KIND = {'gc': 'cluster', 'oc': 'cluster', 's': 'galaxy', 's0': 'galaxy', 'sd': 'galaxy', 'e': 'galaxy', 'i': 'galaxy',
        'sfr': 'nebula', 'en': 'nebula', 'rn': 'nebula', 'bn': 'nebula', 'pn': 'nebula', 'snr': 'nebula', 'pos': 'cluster'}
POS = {'M24': ('Star field', 'Sagittarius Star Cloud'), 'M40': ('Double star', 'Winnecke 4'), 'M73': ('Asterism', '')}

def dims(s):
    try:
        parts = [float(x) for x in str(s).replace('×', 'x').split('x') if x.strip()]
    except ValueError:
        return [0, 0]
    if not parts:
        return [0, 0]
    return [r(parts[0], 1), r(parts[1] if len(parts) > 1 else parts[0], 1)]

dso = []
for f in json.load(open(D / 'messier.json'))['features']:
    p = f['properties']
    lon, lat = f['geometry']['coordinates']
    t = p['type']
    tn = TYPE.get(t, 'Deep-sky object')
    common = (p.get('alt') or '').replace('´', '’')
    if f['id'] in POS:
        tn, c2 = POS[f['id']]
        common = common or c2
    mag = p.get('mag')
    mag = r(mag, 1) if mag not in (None, '', 999) and float(mag) < 90 else None
    dso.append({'id': f['id'], 'cat': (p.get('desig') or '').replace(' ', ' '), 'name': common, 'type': tn, 'kind': KIND.get(t, 'cluster'),
                'mag': mag, 'dim': dims(p.get('dim')), 'ra': r(ra_of(lon), 3), 'dec': r(lat, 3)})

# Bright non-Messier showpieces, with their usual names.
EXTRA = {
    'NGC 869': ('Double Cluster (h Persei)', 'C14'), 'NGC 884': ('Double Cluster (χ Persei)', 'C14'),
    'NGC 5139': ('Omega Centauri', 'C80'), 'NGC 104': ('47 Tucanae', 'C106'), 'NGC 3372': ('Carina Nebula', 'C92'),
    'NGC 2264': ('Christmas Tree Cluster', 'C?'), 'NGC 2244': ('Rosette Cluster', 'C50'), 'PGC 17223': ('Large Magellanic Cloud', ''),
    'NGC 292': ('Small Magellanic Cloud', ''), 'IC 2602': ('Southern Pleiades', 'C102'), 'NGC 6231': ('Northern Jewel Box', 'C76'),
    'NGC 2362': ('Tau Canis Majoris Cluster', 'C64'), 'NGC 2451': ('', ''), 'NGC 2516': ('Southern Beehive', 'C96'),
    'NGC 3532': ('Wishing Well Cluster', 'C91'), 'Cr 399': ('Coathanger', ''), 'Cr 256': ('Coma Star Cluster', ''),
    'Cr 39': ('Alpha Persei Cluster', ''), 'IC 2391': ('Omicron Velorum Cluster', 'C85'),
}
seen = {d['cat'] for d in dso}
for f in json.load(open(D / 'dsos.bright.json'))['features']:
    k = f['id']
    if k not in EXTRA:
        continue
    p = f['properties']
    lon, lat = f['geometry']['coordinates']
    nm, _ = EXTRA[k]
    dso.append({'id': k, 'cat': k, 'name': nm or k, 'type': TYPE.get(p['type'], 'Deep-sky object'), 'kind': KIND.get(p['type'], 'cluster'),
                'mag': r(p['mag'], 1), 'dim': dims(p.get('dim')), 'ra': r(ra_of(lon), 3), 'dec': r(lat, 3)})

# A few favourite NGC targets from the fuller catalog.
MORE = {'NGC 6543': "Cat's Eye Nebula", 'NGC 7662': 'Blue Snowball', 'NGC 7009': 'Saturn Nebula', 'NGC 457': 'Owl Cluster',
        'NGC 253': 'Sculptor Galaxy', 'NGC 2392': 'Eskimo Nebula', 'NGC 3242': 'Ghost of Jupiter', 'NGC 4565': 'Needle Galaxy',
        'NGC 7293': 'Helix Nebula', 'NGC 6826': 'Blinking Planetary', 'NGC 7000': 'North America Nebula', 'NGC 752': '',
        'NGC 663': '', 'NGC 6633': '', 'NGC 2403': '', 'NGC 5128': 'Centaurus A', 'NGC 55': '', 'NGC 3628': 'Hamburger Galaxy'}
pool = json.load(open(D / 'dsos.14.json'))['features']
for f in pool:
    k = (f['properties'].get('desig') or f['id']).replace(' ', ' ')
    if k in MORE and k not in seen and k not in {d['cat'] for d in dso}:
        p = f['properties']
        lon, lat = f['geometry']['coordinates']
        try:
            mag = r(p['mag'], 1)
            if mag > 90:
                mag = None
        except (TypeError, ValueError):
            mag = None
        dso.append({'id': k, 'cat': k, 'name': MORE[k] or k, 'type': TYPE.get(p['type'], 'Deep-sky object'), 'kind': KIND.get(p['type'], 'cluster'),
                    'mag': mag, 'dim': dims(p.get('dim')), 'ra': r(ra_of(lon), 3), 'dec': r(lat, 3)})
missing = set(MORE) - {d['cat'] for d in dso}
print('  NGC extras not found:', sorted(missing))
dump('dso.json', {'dso': dso, 'doubles': doubles})
print(f'  {len(dso)} deep-sky objects, {len(doubles)} doubles')

# ---------- Milky Way: sample the outlines onto a grid, one soft glow per cell ----------
mw = json.load(open(D / 'milkyway.json'))['features']

def inside(rings, x, y):
    c = False
    for ring in rings:
        n = len(ring)
        for i in range(n):
            x1, y1 = ring[i]; x2, y2 = ring[i - 1]
            if abs(x1 - x2) > 180:
                continue  # an edge jumping across the ±180° seam
            if (y1 > y) != (y2 > y):
                xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
                if x < xi:
                    c = not c
    return c

levels = [f['geometry']['coordinates'] for f in mw]
bbox = []
for rings in levels:
    ys = [p[1] for ring in rings for p in ring]
    bbox.append((min(ys), max(ys)))
step = 1.6
cells = []
dec = -90 + step / 2
while dec < 90:
    n_ra = max(1, int(round(360 * math.cos(math.radians(dec)) / step)))
    for k in range(n_ra):
        ra = (k + 0.5) * 360 / n_ra
        lon = ra - 360 if ra > 180 else ra
        lv = 0
        for li, rings in enumerate(levels):
            if bbox[li][0] <= dec <= bbox[li][1] and inside(rings, lon, dec):
                lv += 1
        if lv:
            cells += [r(ra, 1), r(dec, 1), lv]
    dec += step
dump('milkyway.json', {'step': step, 'c': cells})
print(f'  {len(cells) // 3} Milky Way cells')

# ---------- cities ----------
cities = json.load(open(CITIES))
tzs = sorted({c['timezone'] for c in cities if c.get('timezone')})
tzi = {t: i for i, t in enumerate(tzs)}
rows = []
for c in sorted(cities, key=lambda c: -(c.get('pop') or 0)):
    if not c.get('timezone'):
        continue
    prov = c.get('state_ansi') or c.get('province') or ''
    rows.append([c['city'], prov, c.get('iso2') or '', r(c['lat']), r(c['lng']), int(c.get('pop') or 0), tzi[c['timezone']]])
dump('cities.json', {'tz': tzs, 'c': rows})
# Default place per time zone: its most populous city.
best = {}
for row in rows:
    t = tzs[row[6]]
    if t not in best:
        best[t] = row
dump('tzcity.json', {t: [v[0], v[1], v[2], v[3], v[4]] for t, v in best.items()})
