# Lab 6 assignment, Part A: turn the flat GDP table into nested JSON.
#
# World > continent > area > country. Unlike the city example, each leaf has
# to keep two attributes rather than one: the GDP amount (which D3 will sum
# into rectangle area) and the GDP status (which becomes colour), so the leaf
# builder takes a mapping of output keys to CSV columns.
#
# Run from anywhere:  python lab6/convert_gdp.py

import json
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SOURCE = DATA_DIR / "lab6_assignment_gdp.csv"
TARGET = DATA_DIR / "lab6_assignment_gdp.json"

LEVELS = ["continent", "area", "country"]

# Output key on the leaf -> column in the CSV, with the type to coerce to
# (pandas returns numpy scalars, which json cannot serialise).
LEAF_FIELDS = {
    "gdp": ("gdp_billion_usd", int),
    "status": ("gdp_status", str),
}

STATUSES = {"Increase", "Unchanged", "Decrease"}

df = pd.read_csv(SOURCE)

# Clean stray whitespace so groupby does not split "Asia" and "Asia ".
for column in LEVELS + ["gdp_status"]:
    df[column] = df[column].str.strip()

# Guard the assumptions the treemap relies on before building anything: every
# path is complete, every country appears once, GDP is positive, and status
# uses only the three expected values.
assert not df[LEVELS + ["gdp_billion_usd", "gdp_status"]].isna().any().any(), "missing values"
assert not df["country"].duplicated().any(), "a country appears twice"
assert (df["gdp_billion_usd"] > 0).all(), "non-positive GDP"
assert set(df["gdp_status"]) <= STATUSES, f"unexpected status: {set(df['gdp_status']) - STATUSES}"


def build_hierarchy(dataframe, levels):

    if len(levels) == 1:

        return [
            {
                "name": row[levels[0]],
                **{key: cast(row[column]) for key, (column, cast) in LEAF_FIELDS.items()}
            }
            for _, row
            in dataframe.iterrows()
        ]

    children = []

    for value, group in dataframe.groupby(levels[0], sort=True):

        children.append({
            "name": value,
            "children": build_hierarchy(group, levels[1:])
        })

    return children


hierarchy = {
    "name": "World",
    "children": build_hierarchy(df, LEVELS)
}

with open(TARGET, "w", encoding="utf-8") as f:

    json.dump(hierarchy, f, indent=2, ensure_ascii=False)

print(
    f"Wrote {len(df)} countries in {df['area'].nunique()} areas and "
    f"{df['continent'].nunique()} continents to {TARGET}"
)
