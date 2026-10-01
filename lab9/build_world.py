# Lab 9, Part A (preparation): build the world GeoJSON the two maps share.
#
# Source: Natural Earth 1:50m Admin 0 – Countries (public domain), the 50m
# scale because the 110m file has no Singapore or Hong Kong, two of the 50
# economies in the GDP table. The script keeps only what the maps need
# (name + ISO-3 code), fixes the ISO-3 codes Natural Earth leaves as -99,
# simplifies the borders as one coverage so neighbours still share edges
# (the cartogram moves shared vertices together, so a gap here would open into
# a visible crack there), and writes data/lab9_world_countries.geojson.
#
# Run from anywhere:  python lab9/build_world.py

import csv
import json
import urllib.request
from pathlib import Path

import shapely
from shapely.geometry import mapping, shape

LAB_DIR = Path(__file__).resolve().parent
DATA_DIR = LAB_DIR.parent / "data"
CACHE = LAB_DIR / ".cache" / "ne_50m_admin_0_countries.geojson"
TARGET = DATA_DIR / "lab9_world_countries.geojson"
GDP = DATA_DIR / "lab9_gdp_2025_top50.csv"

SOURCE_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
              "master/geojson/ne_50m_admin_0_countries.geojson")

TOLERANCE = 0.12   # degrees; ~13 km, about a third of a pixel at world scale
DECIMALS = 3       # ~100 m

if not CACHE.exists():
    CACHE.parent.mkdir(exist_ok=True)
    urllib.request.urlretrieve(SOURCE_URL, CACHE)

source = json.loads(CACHE.read_text(encoding="utf-8"))["features"]


def iso3_of(props):
    # ISO_A3 is -99 for France and Norway (overseas territories and Svalbard
    # break the ISO assignment in Natural Earth) and for a few disputed areas.
    # ADM0_A3 is Natural Earth's own unique code and equals the ISO code for
    # both. ISO_A3_EH is *not* used: it gives AUS to two small Australian
    # territories, which would make Australia appear three times in the join.
    code = props["ISO_A3"]
    return props["ADM0_A3"] if code == "-99" else code


rows = []
fixed = []
for f in source:
    props = f["properties"]
    if props["ADM0_A3"] == "ATA":
        continue  # Antarctica: no economy, and 9% of the land area at the bottom of the map
    if props["ISO_A3"] == "-99":
        fixed.append(iso3_of(props))
    rows.append({"name": props["NAME"], "iso3": iso3_of(props), "geom": shape(f["geometry"])})

codes = [r["iso3"] for r in rows]
assert len(codes) == len(set(codes)), "an ISO-3 code appears on two features"

# Coverage simplification removes the same vertices from both sides of every
# shared border, so the simplified countries still tile without slivers.
simplified = shapely.coverage_simplify([r["geom"] for r in rows], TOLERANCE)

features = []
for r, geom in zip(rows, simplified):
    # D3 draws spherical polygons and expects exterior rings clockwise;
    # GeoJSON (RFC 7946) files are counter-clockwise. Orient explicitly so the
    # file does not depend on which convention the source happened to use.
    geom = shapely.set_precision(shapely.orient_polygons(geom, exterior_cw=True), 0)
    geom = shapely.transform(geom, lambda xy: xy.round(DECIMALS))
    features.append({
        "type": "Feature",
        "properties": {"name": r["name"], "iso3": r["iso3"]},
        "geometry": mapping(geom),
    })

TARGET.write_text(
    json.dumps({"type": "FeatureCollection", "features": features},
               ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8")

# Join check: every economy in the GDP table must find exactly one feature.
with open(GDP, encoding="utf-8") as fh:
    gdp_codes = [row["iso3"] for row in csv.DictReader(fh)]
missing = [c for c in gdp_codes if c not in set(codes)]

n_points = sum(len(shapely.get_coordinates(shape(f["geometry"]))) for f in features)
print(f"{len(features)} features, {n_points:,} vertices, "
      f"{TARGET.stat().st_size / 1024:.0f} KB -> {TARGET.name}")
print(f"GDP economies matched: {len(gdp_codes) - len(missing)} of {len(gdp_codes)}"
      + (f"; unmatched: {missing}" if missing else ""))
print("ISO_A3 was -99, replaced by ADM0_A3:", ", ".join(sorted(fixed)))
