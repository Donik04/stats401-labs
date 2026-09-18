# Lab 6, Tasks 1-2: turn the flat city table into nested JSON for D3.
#
# Each row of lab6_small_hierarchy.csv is one full root-to-leaf path
# (World > continent > country > region > city). Grouping on one level at a
# time and recursing on the remaining levels rebuilds the tree those paths
# describe.
#
# Run from anywhere:  python lab6/convert_hierarchy.py

import json
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

df = pd.read_csv(DATA_DIR / "lab6_small_hierarchy.csv")


def build_hierarchy(dataframe, levels, value_column):

    # Last level: every row is a leaf that carries the value.
    if len(levels) == 1:

        return [
            {
                "name": row[levels[0]],
                # pandas hands back numpy.int64, which json cannot serialise.
                "value": int(row[value_column])
            }
            for _, row
            in dataframe.iterrows()
        ]

    current_level = levels[0]

    children = []

    for value, group in dataframe.groupby(current_level):

        children.append({
            "name": value,
            "children": build_hierarchy(
                group,
                levels[1:],
                value_column
            )
        })

    return children


hierarchy = {
    "name": "World",
    "children": build_hierarchy(
        df,
        ["continent", "country", "region", "city"],
        "population_thousands"
    )
}

with open(DATA_DIR / "lab6_small_hierarchy.json", "w", encoding="utf-8") as f:

    json.dump(hierarchy, f, indent=2, ensure_ascii=False)

print(f"Wrote {len(df)} cities to {DATA_DIR / 'lab6_small_hierarchy.json'}")
