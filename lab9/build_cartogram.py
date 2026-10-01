# Lab 9, Part C: a contiguous GDP cartogram, precomputed.
#
# Algorithm: the diffusion cartogram of Gastner & Newman (2004), "Diffusion-
# based method for producing density-equalizing maps", PNAS 101(20), with the
# repeated passes of Gastner, Seguy & More (2018, PNAS 115(10)). GDP is spread
# over the map as a density (GDP per unit of map area). The density is then
# allowed to diffuse until it is flat everywhere, and every map vertex is
# carried along by the flow -grad(rho)/rho. Countries with more GDP than their
# area "deserves" expand, the others contract, and because one smooth flow
# moves every vertex, borders never cross and neighbours stay neighbours.
#
# Why precompute: a first attempt ran the iterative rubber-sheet algorithm of
# Dougenik et al. (1985) in the browser — the one topogram uses — and it
# crushed France between six fast-growing neighbours (France ended at 13% of
# its target area, Portugal at 450%). The diffusion method has no such failure,
# but needs FFTs on a 1024 x 512 grid, so it runs once here (~1 min) and the
# page draws the result with D3.
#
# Countries outside the top-50 table have no GDP value. They cannot have zero
# area without breaking the map, so together they get a fixed placeholder share
# (NO_DATA_SHARE) of the total, split by land area. Their size on the cartogram
# therefore says nothing about their economies; the page draws them hatched.
#
# Input:  data/lab9_world_countries.geojson (from build_world.py)
#         data/lab9_gdp_2025_top50.csv
# Output: data/lab9_gdp_cartogram.geojson — same features, same rings, same
#         vertex order, in raw Equal Earth coordinates (y up), so the page can
#         morph each vertex from its geographic to its cartogram position.
#
# Run from anywhere:  python lab9/build_cartogram.py

import csv
import json
from pathlib import Path

import numpy as np
import shapely
from scipy.fft import dctn, idctn
from scipy.ndimage import gaussian_filter
from shapely.geometry import shape

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
WORLD = DATA_DIR / "lab9_world_countries.geojson"
GDP = DATA_DIR / "lab9_gdp_2025_top50.csv"
TARGET = DATA_DIR / "lab9_gdp_cartogram.geojson"

NO_DATA_SHARE = 0.10   # placeholder: share of the map given to all no-data countries
LX, LY = 1024, 512     # diffusion grid
PADDING = 0.6          # the map spans this fraction of the grid, leaving room to grow
PASSES = 8             # each pass re-measures areas and diffuses again
TARGET_ERROR = 0.02    # stop once every top-50 economy is within 2% of its target area


# ----------------------------------------------------------- projection --

def equal_earth(lon, lat):
    """Raw Equal Earth (Šavrič, Patterson & Jenny 2018), the same formula as
    d3.geoEqualEarthRaw, so the page's choropleth and this file agree."""
    a1, a2, a3, a4 = 1.340264, -0.081106, 0.000893, 0.003796
    m = np.sqrt(3) / 2
    lam, phi = np.radians(lon), np.radians(lat)
    l = np.arcsin(m * np.sin(phi))
    l2 = l * l
    l6 = l2 * l2 * l2
    x = lam * np.cos(l) / (m * (a1 + 3 * a2 * l2 + l6 * (7 * a3 + 9 * a4 * l2)))
    y = l * (a1 + a2 * l2 + l6 * (a3 + a4 * l2))
    return x, y


# ------------------------------------------------------------------ load --

world = json.loads(WORLD.read_text(encoding="utf-8"))
with open(GDP, encoding="utf-8") as fh:
    gdp = {r["iso3"]: float(r["gdp_2025_billion_usd"]) for r in csv.DictReader(fh)}

features = world["features"]
n = len(features)

# Flatten every ring into one vertex array, remembering where each ring sits,
# so the whole map can be moved with one vectorised call per time step.
ring_slices = []          # per feature: list of polygons, each a list of (start, stop)
chunks = []
cursor = 0
for f in features:
    g = f["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    feature_rings = []
    for rings in polys:
        poly = []
        for ring in rings:
            arr = np.asarray(ring, dtype=float)
            chunks.append(arr)
            poly.append((cursor, cursor + len(arr)))
            cursor += len(arr)
        feature_rings.append(poly)
    ring_slices.append(feature_rings)

lonlat = np.concatenate(chunks)
px, py = equal_earth(lonlat[:, 0], lonlat[:, 1])
geo_xy = np.column_stack([px, py])          # undistorted, raw Equal Earth units

# Grid coordinates: square cells, the map centred in a padded domain.
xmin, ymin = geo_xy.min(axis=0)
xmax, ymax = geo_xy.max(axis=0)
cell = max((xmax - xmin) / (LX * PADDING), (ymax - ymin) / (LY * PADDING))
origin = np.array([(xmin + xmax) / 2 - LX * cell / 2, (ymin + ymax) / 2 - LY * cell / 2])
to_grid = lambda xy: (xy - origin) / cell
to_raw = lambda g: g * cell + origin


def polygons_of(xy, j):
    return shapely.MultiPolygon([
        shapely.Polygon(xy[a:b][:-1], [xy[c:d][:-1] for c, d in rest])
        for (a, b), *rest in ring_slices[j]
    ])


def areas(xy):
    return np.array([polygons_of(xy, j).area for j in range(n)])


# ---------------------------------------------------------------- values --

codes = [f["properties"]["iso3"] for f in features]
has_data = np.array([c in gdp for c in codes])
geo_area = areas(geo_xy)
total_gdp = sum(gdp.values())

# No-data countries share NO_DATA_SHARE of the map in proportion to land area.
values = np.where(has_data, [gdp.get(c, 0.0) for c in codes], 0.0)
placeholder_total = NO_DATA_SHARE / (1 - NO_DATA_SHARE) * total_gdp
values[~has_data] = placeholder_total * geo_area[~has_data] / geo_area[~has_data].sum()
target_share = values / values.sum()

missing = sorted(set(gdp) - set(codes))
assert not missing, f"GDP codes with no feature: {missing}"


# ------------------------------------------------------------- diffusion --

gx, gy = np.meshgrid(np.arange(LX) + 0.5, np.arange(LY) + 0.5)
kx = np.pi * np.arange(LX) / LX
ky = np.pi * np.arange(LY) / LY
k2 = ky[:, None] ** 2 + kx[None, :] ** 2


def density_grid(grid_xy):
    """GDP per cell: each country's value spread evenly over its cells, the
    sea at the mean density so it neither pulls nor pushes."""
    a = areas(grid_xy)
    mean = values.sum() / a.sum()
    rho = np.full((LY, LX), mean)
    for j in range(n):
        poly = polygons_of(grid_xy, j)
        x0, y0, x1, y1 = poly.bounds
        i0, i1 = max(int(y0), 0), min(int(y1) + 1, LY)
        j0, j1 = max(int(x0), 0), min(int(x1) + 1, LX)
        sub_x, sub_y = gx[i0:i1, j0:j1], gy[i0:i1, j0:j1]
        inside = shapely.contains_xy(poly, sub_x, sub_y)
        if inside.any():
            rho[i0:i1, j0:j1][inside] = values[j] / a[j]
        else:
            # Smaller than one cell (Singapore, Hong Kong on the first pass):
            # put its whole excess GDP into the cell under its centroid.
            c = poly.centroid
            ci, cj = min(int(c.y), LY - 1), min(int(c.x), LX - 1)
            rho[ci, cj] += values[j] - mean * a[j]
    return gaussian_filter(rho, 1.0)


def bilinear(field, pts):
    x = np.clip(pts[:, 0] - 0.5, 0, LX - 1.001)
    y = np.clip(pts[:, 1] - 0.5, 0, LY - 1.001)
    i, j = y.astype(int), x.astype(int)
    fy, fx = y - i, x - j
    return (field[i, j] * (1 - fx) * (1 - fy) + field[i, j + 1] * fx * (1 - fy)
            + field[i + 1, j] * (1 - fx) * fy + field[i + 1, j + 1] * fx * fy)


def velocity(coef, t, pts):
    rho = idctn(coef * np.exp(-k2 * t), type=2, norm="ortho")
    dy, dx = np.gradient(rho)
    vx, vy = -dx / rho, -dy / rho
    return np.column_stack([bilinear(vx, pts), bilinear(vy, pts)])


def diffuse(grid_xy):
    """Carry the vertices along the diffusion flow until the density is flat
    (Heun's method with an adaptive step)."""
    coef = dctn(density_grid(grid_xy), type=2, norm="ortho")
    pts = grid_xy.copy()
    t, dt = 0.0, 0.1
    t_end = 2 * (LX / np.pi) ** 2      # slowest mode decayed by e^-2... and beyond
    while t < t_end:
        v0 = velocity(coef, t, pts)
        trial = pts + dt * v0
        v1 = velocity(coef, t + dt, trial)
        new = pts + dt / 2 * (v0 + v1)
        if np.abs(new - trial).max() > 0.05 and dt > 1e-3:
            dt /= 2
            continue
        pts, t = new, t + dt
        dt = min(dt * 1.5, 0.4 / max(np.abs(v1).max(), 1e-9))
        if np.abs(v1).max() * dt < 1e-4:
            break
    return pts


grid_xy = to_grid(geo_xy)
for p in range(1, PASSES + 1):
    grid_xy = diffuse(grid_xy)
    share = areas(grid_xy)
    share /= share.sum()
    err = share / target_share - 1
    worst = np.argmax(np.abs(np.where(has_data, err, 0)))
    print(f"pass {p}: mean |error| top-50 {np.abs(err[has_data]).mean():.1%}, "
          f"worst {codes[worst]} {err[worst]:+.1%}")
    if np.abs(err[has_data]).max() < TARGET_ERROR:
        break

carto_xy = to_raw(grid_xy)

# ------------------------------------------------------------------ write --

geo_share = geo_area / geo_area.sum()
carto_area = areas(carto_xy)
carto_share = carto_area / carto_area.sum()

out = []
for j, f in enumerate(features):
    polys = [[np.round(carto_xy[a:b], 5).tolist() for a, b in poly] for poly in ring_slices[j]]
    geometry = ({"type": "Polygon", "coordinates": polys[0]}
                if f["geometry"]["type"] == "Polygon"
                else {"type": "MultiPolygon", "coordinates": polys})
    out.append({
        "type": "Feature",
        "properties": {
            **f["properties"],
            "geo_share": round(float(geo_share[j]), 7),
            "carto_share": round(float(carto_share[j]), 7),
            "target_share": round(float(target_share[j]), 7),
        },
        "geometry": geometry,
    })

TARGET.write_text(
    json.dumps({"type": "FeatureCollection",
                "no_data_share": NO_DATA_SHARE,
                "features": out}, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8")

print(f"wrote {TARGET.name} ({TARGET.stat().st_size / 1024:.0f} KB)")
print("\niso3  gdp      geo%    carto%  x geo  vs target")
order = sorted(np.flatnonzero(has_data), key=lambda j: -carto_share[j] / geo_share[j])
for j in order:
    print(f"{codes[j]}  {values[j]:8.0f} {geo_share[j]:7.2%} {carto_share[j]:7.2%} "
          f"{carto_share[j] / geo_share[j]:7.1f} {carto_share[j] / target_share[j] - 1:+7.1%}")
