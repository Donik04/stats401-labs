"""Lab 4 step 1 — acquire the raw tweet dataset.

Source  : Gabriel Preda, "COVID19 Tweets"
          https://github.com/gabrielpreda/covid-19-tweets
          (the same collection is published on Kaggle as gpreda/covid19-tweets)
Content : 179,108 tweets carrying the #covid19 hashtag, collected
          2020-07-24 to 2020-08-30, with the raw tweet text and the poster's
          account metadata. No sentiment labels are supplied -- sentiment is
          something we compute ourselves in clean_tweets.py.

The full file is ~69 MB, which is more than belongs in a course repository and
more than a CPU can run a Transformer over in a reasonable time. This script
therefore downloads the full file once into a local cache and writes a
*stratified sample* to data/lab4_raw_tweets.csv: an equal number of tweets
from each calendar day in the collection window.

Sampling by day rather than at random keeps the whole five-week window visible
in the time axis of the visualization. The sample is written completely
unmodified -- every original column, no cleaning -- so that clean_tweets.py
starts from genuinely raw data.
"""

import sys
from pathlib import Path

import pandas as pd
import requests

SOURCE_URL = (
    "https://raw.githubusercontent.com/gabrielpreda/"
    "covid-19-tweets/master/covid19_tweets.csv"
)

HERE = Path(__file__).resolve().parent
CACHE_PATH = HERE / ".cache" / "covid19_tweets.csv"
RAW_OUT = HERE.parent / "data" / "lab4_raw_tweets.csv"

# The assignment asks for at least 1,000 tweets. 26 collection days x 40 gives
# 1,040 raw rows, which leaves a small margin for the rows that cleaning
# removes so that the scored dataset still clears 1,000.
PER_DAY = 40
RANDOM_SEED = 401       # fixed so the sample is reproducible
CHUNK = 1 << 20


def download(url, path):
    """Stream the source file to disk, resuming a partial download.

    The file is large and the connection to GitHub is not always quick, so a
    half-finished download is resumed with a Range request rather than
    restarted from zero.
    """
    path.parent.mkdir(parents=True, exist_ok=True)

    have = path.stat().st_size if path.exists() else 0

    # "identity" matters: without it the server answers with a gzipped body and
    # a compressed Content-Length, which does not line up with the byte offsets
    # a resumed Range request is counted in.
    headers = {
        "User-Agent": "STATS401-Class-Exercise/1.0",
        "Accept-Encoding": "identity",
    }

    # How big is the file meant to be? If we already have all of it, stop.
    head = requests.head(url, headers=headers, timeout=30, allow_redirects=True)
    total = int(head.headers.get("Content-Length", 0))

    if total and have >= total:
        print(f"Using cached download ({have:,} bytes)")
        return

    if have and total:
        print(f"Resuming download at {have:,} of {total:,} bytes")
        headers["Range"] = f"bytes={have}-"
    else:
        have = 0
        print(f"Downloading {total:,} bytes from {url}")

    mode = "ab" if have else "wb"

    with requests.get(url, headers=headers, stream=True, timeout=120) as response:
        response.raise_for_status()

        with open(path, mode) as handle:
            for block in response.iter_content(CHUNK):
                handle.write(block)
                have += len(block)
                if total:
                    print(f"\r  {100 * have / total:5.1f}%", end="", flush=True)

    print(f"\r  done ({have:,} bytes)")


def stratified_sample(frame, per_day, seed):
    """Take up to `per_day` tweets from each calendar day.

    A day holding fewer than `per_day` tweets contributes everything it has.
    """
    day = pd.to_datetime(frame["date"], errors="coerce").dt.date

    sample = (
        frame.groupby(day, group_keys=False)
        .apply(lambda group: group.sample(
            n=min(per_day, len(group)),
            random_state=seed,
        ))
    )

    # Restore chronological order; the groupby leaves it grouped by day anyway,
    # but sorting makes the saved file easier to read.
    return sample.sort_values("date")


def main():
    download(SOURCE_URL, CACHE_PATH)

    print(f"\nReading {CACHE_PATH}")
    frame = pd.read_csv(CACHE_PATH)
    print(f"Full dataset: {len(frame):,} rows x {len(frame.columns)} columns")

    days = pd.to_datetime(frame["date"], errors="coerce").dt.date
    print(f"Collection window: {days.min()} to {days.max()} "
          f"({days.nunique()} days with tweets)")

    sample = stratified_sample(frame, PER_DAY, RANDOM_SEED)

    RAW_OUT.parent.mkdir(parents=True, exist_ok=True)
    sample.to_csv(RAW_OUT, index=False)

    print(f"\nWrote {len(sample):,} raw rows x {len(sample.columns)} columns")
    print(f"  -> {RAW_OUT}")
    print("\nColumns:", ", ".join(sample.columns))


if __name__ == "__main__":
    sys.exit(main())
