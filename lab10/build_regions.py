# Lab 10 (preparation): the continent of every country on the Lab 9 maps.
#
# Voice commands such as "show Asia" need to know which countries belong to
# which continent, and the Lab 9 boundary file keeps only name + ISO-3. This
# script reads the same Natural Earth 1:50m source Lab 9 used, applies the
# same ISO-3 repair (ADM0_A3 where ISO_A3 is -99), and writes one row per
# feature of data/lab9_world_countries.geojson to data/lab10_regions.csv.
#
# Continents are Natural Earth's CONTINENT field, so Russia counts as Europe
# and Turkey as Asia.
#
# Run from anywhere:  python lab10/build_regions.py

import csv
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "lab9" / ".cache" / "ne_50m_admin_0_countries.geojson"
WORLD = ROOT / "data" / "lab9_world_countries.geojson"
TARGET = ROOT / "data" / "lab10_regions.csv"

SOURCE_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
              "master/geojson/ne_50m_admin_0_countries.geojson")

if not CACHE.exists():
    CACHE.parent.mkdir(exist_ok=True)
    urllib.request.urlretrieve(SOURCE_URL, CACHE)


def iso3_of(props):
    code = props["ISO_A3"]
    return props["ADM0_A3"] if code == "-99" else code


source = json.loads(CACHE.read_text(encoding="utf-8"))["features"]
continent_of = {iso3_of(f["properties"]): f["properties"]["CONTINENT"] for f in source}

world = json.loads(WORLD.read_text(encoding="utf-8"))["features"]
rows = [{"iso3": f["properties"]["iso3"],
         "name": f["properties"]["name"],
         "continent": continent_of[f["properties"]["iso3"]]} for f in world]

with open(TARGET, "w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=["iso3", "name", "continent"])
    writer.writeheader()
    writer.writerows(rows)

counts = {}
for r in rows:
    counts[r["continent"]] = counts.get(r["continent"], 0) + 1
print(f"{len(rows)} countries -> {TARGET.name}")
for name, n in sorted(counts.items(), key=lambda kv: -kv[1]):
    print(f"  {name}: {n}")
