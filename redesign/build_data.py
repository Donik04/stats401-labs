"""Individual project -- data for the World Happiness Report redesign.

Original : World Happiness Report 2026, Chapter 2, Figure 2.1
           "Country rankings by life evaluations" (parts 1-3, pp. 21-23)
           https://files.worldhappiness.report/WHR26.pdf
Sources  : WHR26_Data_Figure_2.1.xlsx  -- the figure's own data, published by
           the WHR alongside the report (2011-2025; the 2025 rows are the
           2023-2025 averages the figure draws)
           WHR26.pdf -- the rank confidence intervals, e.g. "(2-4)", which are
           printed in the figure but are not in the spreadsheet
           WHR21_Data_Figure_2.1.xls -- the report's own ten-region grouping
           ("Regional indicator"), which the 2026 files no longer include
Outputs  : data/redesign_whr2026.csv    one row per ranked country (147)
           redesign/img/whr26_fig2-1_part{1,2,3}.png   the original figure

The six "Explained by" columns are each factor's contribution to the ladder
score measured from Dystopia, a hypothetical country with the world's lowest
value of every factor, whose own score the report puts at 1.16. So

    ladder score = 1.16 + sum of six contributions + residual

and the spreadsheet's last column is 1.16 + residual. The page re-centres the
contributions on the average country itself; this script only tidies the data
and records what the figure leaves out.
"""

import re
import sys
import urllib.request
from pathlib import Path

import pandas as pd
import pymupdf

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
IMG = HERE / "img"
CACHE = HERE / ".cache"

SOURCES = {
    "fig21_2026.xlsx": "https://files.worldhappiness.report/WHR26_Data_Figure_2.1.xlsx",
    "fig21_2021.xls": "https://files.worldhappiness.report/WHR21_Data_Figure_2.1.xls",
    "WHR26.pdf": "https://files.worldhappiness.report/WHR26.pdf",
}

OUT = DATA / "redesign_whr2026.csv"

YEAR = 2025                 # the 2023-2025 window, i.e. WHR 2026
DYSTOPIA = 1.16             # Dystopia's ladder score, from the figure legend
FIGURE_PAGES = [22, 23, 24] # 0-based: printed pages 21-23
PANEL = pymupdf.Rect(63, 90, 549, 729)   # the tinted figure panel, in points

FACTORS = {
    "Explained by: Log GDP per capita": "gdp",
    "Explained by: Social support": "social",
    "Explained by: Healthy life expectancy": "health",
    "Explained by: Freedom to make life choices": "freedom",
    "Explained by: Generosity": "generosity",
    "Explained by: Perceptions of corruption": "corruption",
}

# Names the report changed between 2021 and 2026, mapped to the 2021 spelling.
ALIASES = {
    "Czechia": "Czech Republic",
    "Viet Nam": "Vietnam",
    "Republic of Korea": "South Korea",
    "Republic of Moldova": "Moldova",
    "Russian Federation": "Russia",
    "Hong Kong SAR of China": "Hong Kong S.A.R. of China",
    "Lao PDR": "Laos",
    "Türkiye": "Turkey",
    "Côte d’Ivoire": "Ivory Coast",
    "State of Palestine": "Palestinian Territories",
    "Congo": "Congo (Brazzaville)",
    "Eswatini": "Swaziland",
}

# Five countries were not ranked in 2021 at all, so they are placed by hand in
# the region their neighbours in the 2021 grouping belong to.
NEW_COUNTRIES = {
    "Belize": "Latin America and Caribbean",
    "Trinidad and Tobago": "Latin America and Caribbean",
    "Oman": "Middle East and North Africa",
    "Somalia": "Sub-Saharan Africa",
    "DR Congo": "Sub-Saharan Africa",
}

# "12 (9-24) Mexico (6.972)" -- rank, rank c.i., name, score. The PDF sets the
# range with an en dash and sometimes breaks the line after the bracket.
RANK_LINE = re.compile(r"(\d{1,3})\s*\((\d{1,3})[–-](\d{1,3})\)\s*(.+?)\s*\((\d\.\d{3})\)")


def rule(title):
    print(f"\n{'=' * 68}\n{title}\n{'=' * 68}")


def fetch(name):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / name
    if not path.exists():
        print(f"downloading {SOURCES[name]}")
        urllib.request.urlretrieve(SOURCES[name], path)
    return path


def load_scores():
    raw = pd.read_excel(fetch("fig21_2026.xlsx"))
    df = raw[raw["Year"] == YEAR].rename(columns={
        "Rank": "rank",
        "Country name": "country",
        "Life evaluation (3-year average)": "score",
        "Lower whisker": "score_lo",
        "Upper whisker": "score_hi",
        "Dystopia + residual": "dystopia_residual",
        **FACTORS,
    })
    df = df.drop(columns="Year").reset_index(drop=True)
    df["rank"] = df["rank"].astype(int)
    print(f"{len(df)} countries ranked for {YEAR - 2}-{YEAR}")
    return df


def load_rank_ranges(doc):
    text = " ".join(doc[i].get_text() for i in FIGURE_PAGES)
    text = re.sub(r"\s+", " ", text)
    rows = [
        {"rank": int(r), "rank_lo": int(lo), "rank_hi": int(hi),
         "pdf_name": name.strip(), "pdf_score": float(score)}
        for r, lo, hi, name, score in RANK_LINE.findall(text)
    ]
    return pd.DataFrame(rows)


def load_regions():
    old = pd.read_excel(fetch("fig21_2021.xls"))
    return dict(zip(old["Country name"], old["Regional indicator"]))


def save_figure(doc):
    IMG.mkdir(exist_ok=True)
    for part, index in enumerate(FIGURE_PAGES, start=1):
        pix = doc[index].get_pixmap(dpi=150, clip=PANEL)
        path = IMG / f"whr26_fig2-1_part{part}.png"
        pix.save(path)
        print(f"wrote {path.relative_to(HERE.parent)}  ({pix.width} x {pix.height})")

    # A close-up of ranks 79-92 for the critique: Venezuela's missing GDP bar,
    # Tajikistan with no bars at all, and Hong Kong's bars running past its
    # own confidence interval all sit in these fourteen rows.
    page = doc[FIGURE_PAGES[1]]
    top = page.search_for("Russian Federation")[0]
    bottom = page.search_for("Lao PDR")[0]
    clip = pymupdf.Rect(PANEL.x0 + 30, top.y0 - 3, PANEL.x1 - 20, bottom.y1 + 3)
    pix = page.get_pixmap(dpi=220, clip=clip)
    path = IMG / "whr26_fig2-1_closeup.png"
    pix.save(path)
    print(f"wrote {path.relative_to(HERE.parent)}  ({pix.width} x {pix.height})")


def main():
    rule("1. The figure's own data")
    df = load_scores()

    rule("2. Rank confidence intervals, read from the printed figure")
    doc = pymupdf.open(fetch("WHR26.pdf"))
    ranges = load_rank_ranges(doc)
    print(f"parsed {len(ranges)} rank lines from pages 21-23")
    df = df.merge(ranges, on="rank", how="left", validate="one_to_one")

    # The PDF and the spreadsheet must agree row for row before the ranges are
    # trusted: same score at the same rank.
    off = df[(df["pdf_score"] - df["score"].round(3)).abs() > 0.0005]
    if df["rank_lo"].isna().any() or len(off):
        sys.exit(f"rank ranges do not line up with the spreadsheet:\n{off}")
    print("every rank range matches its spreadsheet row by rank and score")
    df = df.drop(columns=["pdf_name", "pdf_score"])
    df["rank_lo"] = df["rank_lo"].astype(int)
    df["rank_hi"] = df["rank_hi"].astype(int)

    rule("3. Regions (the report's WHR 2021 grouping)")
    regions = load_regions()
    df["region"] = [
        NEW_COUNTRIES.get(c) or regions.get(ALIASES.get(c, c)) for c in df["country"]
    ]
    if df["region"].isna().any():
        sys.exit(f"no region for: {df.loc[df['region'].isna(), 'country'].tolist()}")
    print(df["region"].value_counts().to_string())

    rule("4. What the figure does not say")
    factors = list(FACTORS.values())
    df["residual"] = (df["dystopia_residual"] - DYSTOPIA).round(3)
    df["missing"] = df[factors].isna().apply(
        lambda row: ";".join(f for f, gone in row.items() if gone), axis=1)

    for _, r in df[df["missing"] != ""].iterrows():
        print(f"{r['country']:<20} missing {r['missing']:<10} -> no bars at all in the figure")

    stacked = df[factors + ["dystopia_residual"]].clip(lower=0).sum(axis=1)
    over = df[stacked > df["score_hi"] + 0.0005]
    for _, r in over.iterrows():
        print(f"{r['country']:<22} bars reach {stacked[_]:.3f}, score {r['score']:.3f} "
              f"(upper whisker {r['score_hi']:.3f})")

    zero = {f: df.loc[df[f] == 0, "country"].tolist() for f in factors}
    print("zero contribution (sets Dystopia):", zero)

    longest = df[factors + ["dystopia_residual"]].idxmax(axis=1)
    print(f"'Dystopia + residual' is the longest sub-bar for "
          f"{(longest == 'dystopia_residual').sum()} of {longest.notna().sum()} countries")

    width = df["rank_hi"] - df["rank_lo"] + 1
    print(f"rank range: median {width.median():.0f} places, "
          f"{(width > 25).sum()} countries wider than 25, widest "
          f"{df.loc[width.idxmax(), 'country']} ({width.max()})")

    top, bottom = df.nsmallest(20, "rank"), df.nlargest(20, "rank")
    print(f"spread of top 20: {top['score'].max() - top['score'].min():.3f}; "
          f"bottom 20: {bottom['score'].max() - bottom['score'].min():.3f}")

    rule("5. Write")
    cols = ["rank", "rank_lo", "rank_hi", "country", "region",
            "score", "score_lo", "score_hi", *factors,
            "dystopia_residual", "residual", "missing"]
    df[cols].to_csv(OUT, index=False, float_format="%.3f")
    print(f"wrote {OUT.relative_to(HERE.parent)}  ({len(df)} rows)")
    save_figure(doc)


if __name__ == "__main__":
    main()
