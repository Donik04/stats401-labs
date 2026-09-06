"""Lab 4 step 2 -- clean the raw tweets, then derive term and sentiment data.

Input  : data/lab4_raw_tweets.csv   (written by fetch_tweets.py, untouched)
Outputs: data/lab4_clean_tweets.csv     one tidy row per surviving tweet
         data/lab4_viz_tweets.csv       the slim per-tweet file the page loads
         data/lab4_sentiment_by_client.csv
         data/lab4_sentiment_by_day.csv
         data/lab4_top_terms.csv
         data/lab4_uncertain_tweets.csv

The script prints a running report of every decision it makes, so that reading
its output is enough to understand how the raw file became the clean one.

Pipeline
    raw -> inspect -> clean structured fields
        -> (A) normalise / tokenise / lemmatise -> DTM -> TF-IDF
        -> (B) lightly normalise -> RoBERTa -> sentiment
        -> tidy -> aggregates
"""

import os
import re
import sys
import unicodedata
from pathlib import Path

# transformers probes for TensorFlow at import time. This machine has a TF
# install that is incompatible with its Keras 3, and the probe turns into an
# import error, so the framework is pinned to PyTorch before the import runs.
os.environ["USE_TF"] = "0"
os.environ["USE_TORCH"] = "1"

import pandas as pd

# Tweets carry emoji and non-Latin scripts. Windows' default console codepage
# cannot encode them, so printing a tweet would otherwise crash the script.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"

RAW_IN = DATA / "lab4_raw_tweets.csv"

# A term must appear in at least MIN_DF tweets and no more than MAX_DF of them.
# MIN_DF is an absolute count, so it has to suit the corpus size: 3 of ~1,000
# tweets is already a rarer term than 5 of 10,000 would be.
MIN_DF = 3
MAX_DF = 0.60
TOP_TERMS = 12          # characteristic terms reported per sentiment class
SENTIMENT_BATCH = 32
MAX_TOKENS = 128        # a tweet is 280 characters; 128 word-pieces covers it
RANDOM_SEED = 401


def rule(title):
    print(f"\n{'=' * 68}\n{title}\n{'=' * 68}")


# ---------------------------------------------------------------------------
# Task 1 -- inspect the raw data
# ---------------------------------------------------------------------------

def inspect(df):
    rule("Task 1 -- inspect the raw data")

    print(f"shape: {df.shape[0]:,} rows x {df.shape[1]} columns\n")
    print(df.dtypes.to_string())

    print("\nmissing values per column:")
    missing = df.isna().sum()
    for column, count in missing[missing > 0].items():
        print(f"  {column:<18} {count:>6,}  ({100 * count / len(df):.1f}%)")

    print(f"\nexactly duplicated rows: {df.duplicated().sum()}")
    print(f"distinct values in 'source': {df['source'].nunique()}")
    print(f"distinct values in 'user_location': {df['user_location'].nunique()}")

    # A column holding one value everywhere carries no information.
    constant = [c for c in df.columns if df[c].nunique(dropna=False) == 1]
    print(f"constant columns: {constant or 'none'}")


# ---------------------------------------------------------------------------
# Task 6 helpers -- string repair and category standardisation
# ---------------------------------------------------------------------------

# Some client names are written with Greek or Cyrillic letters that look like
# Latin ones -- this dataset contains a literal "Tweetbot for iOS" whose "O" is
# a Greek omicron. Folding the lookalikes keeps those rows from splitting off
# into their own category.
LOOKALIKES = str.maketrans(
    "ΑΒΕΖΗΙΚΜΝΟΡΤΥΧАВЕКМНОРСТУХ",
    "ABEZHIKMNOPTYXABEKMHOPCTYX",
)

ZERO_WIDTH = re.compile(r"[\u200b-\u200f\u2060\ufeff\ufffd]")


def tidy_text(value):
    """Repair a free-text field without changing the words in it.

    Unicode is normalised to NFKC so that decorative maths-alphanumeric letters
    (this dataset has tweets written in 𝗯𝗼𝗹𝗱 𝘀𝗮𝗻𝘀) become ordinary letters,
    zero-width and replacement characters are dropped, and runs of whitespace
    (including the newlines inside a tweet) collapse to single spaces.
    """
    if pd.isna(value):
        return pd.NA

    text = unicodedata.normalize("NFKC", str(value))
    text = ZERO_WIDTH.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()

    return text or pd.NA


def canonical_source(value):
    """Normalise a posting-client string before it is categorised."""
    text = tidy_text(value)
    if pd.isna(text):
        return pd.NA

    text = text.translate(LOOKALIKES)
    # Trailing punctuation is inconsistent in this column: the data holds both
    # "Smarp." and "Smarp", and "Publer " with a trailing space.
    text = text.strip(" .,;:-–—|")

    return text or pd.NA


# Categories below describe *how a tweet reached Twitter*, which is the
# attribute the visualization pairs with sentiment. First-party consumer
# clients are matched exactly; everything else is matched on keywords.

FIRST_PARTY_MOBILE = {
    "twitter for iphone", "twitter for ipad", "twitter for android",
}

FIRST_PARTY_WEB = {
    "twitter web app", "twitter web client", "twitter for mac",
    "mobile web (m2)", "mobile web (m5)", "mobile web",
}

# Third-party apps a person taps out a tweet in, same as the official app.
THIRD_PARTY_APP = [
    "tweetbot", "tweetcaster", "twidere", "flamingo", "echofon", "talon",
    "fenix", "ubersocial", "plume", "twitterrific", "twitpane", "tweetlogix",
]

# Publishing suites: a person wrote the tweet, but scheduled it through a
# marketing or newsroom platform.
SCHEDULING_TOOL = [
    "hootsuite", "buffer", "sprout social", "sprinklr", "hubspot", "zoho",
    "coschedule", "oktopost", "khoros", "later", "socialpilot", "agorapulse",
    "eclincher", "loomly", "echobox", "falcon", "socialflow", "socialbakers",
    "meetedgar", "smarterqueue", "crowdfire", "missinglettr", "heyorca",
    "publer", "oneup", "social studio", "dynamic signal", "everyonesocial",
    "postbeyond", "smarp", "orlo", "bambu", "contentstudio", "semrush",
    "clearview social", "grabyo", "social genie", "socialoomph", "zift",
    "fabrik.fm", "cubi.so", "media studio", "twitter for advertisers",
    "sendible", "postcron", "brandwatch", "hocalwire", "social share",
    "socialshare", "tweet suite", "social media publisher", "fs poster",
    "blog2social", "true anthem", "socialnewsdesk", "phone2action",
    "dlvr.it", "paper.li",
]

# No human present at posting time: rule engines, RSS bridges, alert accounts.
AUTOMATION = [
    "ifttt", "zapier", "integromat", "twittbot", "autotweet", "auto tweet",
    "cheap bots", "bot", "rss", "feed", "alerts", "updates", "typepad",
    "wordpress", "tumblr", "bitly", "tweet pro", "scheduler", "statusbot",
    "counter", "tracker", "preprint", "comments", "recoveries", "_test",
    "data",
]

# Written somewhere else and mirrored onto Twitter.
CROSS_POSTED = [
    "instagram", "linkedin", "facebook", "youtube", "tiktok", "pinterest",
    "medium", "twitch", "snapchat", "poshmark", "periscope",
]


def posting_route(source):
    """Collapse 200-odd client strings into six interpretable categories."""
    if pd.isna(source):
        return pd.NA

    value = str(source).lower()

    if value in FIRST_PARTY_MOBILE:
        return "Phone or tablet app"
    if value in FIRST_PARTY_WEB:
        return "Twitter website"
    if value == "tweetdeck":
        return "TweetDeck"

    # Order matters below: "Tweetbot" contains "bot", so real apps are matched
    # before the automation keywords get a chance at them.
    if any(key in value for key in THIRD_PARTY_APP):
        return "Phone or tablet app"
    if any(key in value for key in CROSS_POSTED):
        return "Cross-posted"
    if any(key in value for key in SCHEDULING_TOOL):
        return "Scheduling tool"
    if any(key in value for key in AUTOMATION):
        return "Bot or auto-feed"

    return "Other or custom app"


# user_location is free text with 3,600 distinct spellings in this sample, so
# it cannot be mapped exhaustively. These keywords recover the countries that
# appear often enough to be worth reporting; everything else stays missing
# rather than being guessed at.
COUNTRY_KEYWORDS = [
    ("United States", [
        "usa", "us", "u.s.a", "u.s", "united states", "america", "washington",
        "new york", "los angeles", "chicago", "california", "texas",
        "florida", "boston", "seattle", "atlanta", "denver", "philadelphia",
        "houston", "san francisco", "nyc",
    ]),
    ("India", ["india", "delhi", "mumbai", "bengaluru", "bangalore",
               "chennai", "kolkata", "hyderabad", "pune", "bharat"]),
    ("United Kingdom", ["united kingdom", "uk", "england", "london",
                        "scotland", "wales", "manchester", "britain"]),
    ("Canada", ["canada", "toronto", "ontario", "vancouver", "montreal"]),
    ("Australia", ["australia", "sydney", "melbourne", "brisbane"]),
    ("Nigeria", ["nigeria", "lagos", "abuja"]),
    ("South Africa", ["south africa", "johannesburg", "cape town"]),
    ("Ireland", ["ireland", "dublin"]),
    ("Pakistan", ["pakistan", "karachi", "lahore", "islamabad"]),
    ("Kenya", ["kenya", "nairobi"]),
    ("Philippines", ["philippines", "manila"]),
    ("Global / unstated", ["worldwide", "global", "everywhere", "earth",
                           "planet", "internet", "www"]),
]

# Two-letter US state codes, as they appear in "Austin, TX".
US_STATES = re.compile(
    r",\s*(a[klrz]|c[aot]|de|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|"
    r"n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy])\b"
)


# Keywords are matched on word boundaries, not as bare substrings: "us" must
# not fire on "Belarus", and "uk" must not fire on "Lucknow".
COUNTRY_PATTERNS = [
    (country, re.compile(
        "|".join(r"\b" + re.escape(key) + r"\b" for key in keywords)
    ))
    for country, keywords in COUNTRY_KEYWORDS
]


def to_country(value):
    """Best-effort country for a free-text location, or missing."""
    text = tidy_text(value)
    if pd.isna(text):
        return pd.NA

    lowered = str(text).lower()

    if US_STATES.search(lowered):
        return "United States"

    for country, pattern in COUNTRY_PATTERNS:
        if pattern.search(lowered):
            return country

    return pd.NA


# ---------------------------------------------------------------------------
# Tasks 2-6 -- clean the structured fields
# ---------------------------------------------------------------------------

def clean_structured(df):
    rule("Tasks 2-6 -- clean the structured fields")
    before = len(df)

    # --- Task 2: missing values -------------------------------------------
    # A tweet with no text cannot be scored or tokenised, so those rows go.
    # Missing user_location and hashtags are left missing: "this account did
    # not state a location" is a fact about the account, and replacing it with
    # a zero or an empty string would invent information.
    df = df.dropna(subset=["text"]).copy()
    print(f"dropped {before - len(df)} rows with no tweet text")

    # --- Task 3: duplicates ------------------------------------------------
    exact = df.duplicated().sum()
    df = df.drop_duplicates()
    print(f"dropped {exact} exactly duplicated rows")

    # Exact duplicates are rare here, but the same campaign text is posted
    # many times with a different tracking link on the end. Comparing tweets
    # with links, case and punctuation removed finds those near-copies, which
    # would otherwise let one petition template dominate a sentiment total.
    def dedup_key(text):
        key = str(text).lower()
        key = re.sub(r"https?://\S+|www\.\S+", " ", key)
        key = re.sub(r"[^a-z0-9 ]", " ", key)
        return re.sub(r"\s+", " ", key).strip()

    keys = df["text"].map(dedup_key)
    repeated = keys.duplicated().sum()
    df = df.loc[~keys.duplicated()].copy()
    print(f"dropped {repeated} near-duplicate tweets "
          f"(same wording, different link)")

    # --- Task 4: data types ------------------------------------------------
    for column in ["user_followers", "user_friends", "user_favourites"]:
        df[column] = pd.to_numeric(df[column], errors="coerce")
        # A follower count cannot be negative; treat any such value as unknown.
        negative = (df[column] < 0).sum()
        if negative:
            print(f"{column}: {negative} negative values set to missing")
            df.loc[df[column] < 0, column] = pd.NA

    df["user_verified"] = df["user_verified"].astype("boolean")

    # is_retweet is False on every row in this collection, so it separates
    # nothing and is dropped rather than carried into the tidy output.
    if df["is_retweet"].nunique(dropna=False) == 1:
        print(f"dropped constant column 'is_retweet' "
              f"(always {df['is_retweet'].iloc[0]})")
        df = df.drop(columns=["is_retweet"])

    # --- Task 5: dates -----------------------------------------------------
    df["created_at"] = pd.to_datetime(df["date"], errors="coerce")
    unparsed = df["created_at"].isna().sum()
    print(f"unparseable timestamps: {unparsed}")
    df = df.dropna(subset=["created_at"]).copy()

    df["date"] = df["created_at"].dt.date
    df["hour"] = df["created_at"].dt.hour
    df["weekday"] = df["created_at"].dt.day_name()

    df["account_created"] = pd.to_datetime(df["user_created"], errors="coerce")
    df = df.drop(columns=["user_created"])

    # --- Task 6: categories and strings ------------------------------------
    df["user_name"] = df["user_name"].map(tidy_text)
    df["text"] = df["text"].map(tidy_text)
    df = df.dropna(subset=["text"]).copy()

    raw_sources = df["source"].nunique()
    df["client"] = df["source"].map(canonical_source)
    df["posted_via"] = df["client"].map(posting_route)

    print(f"standardised 'source': {raw_sources} raw strings -> "
          f"{df['posted_via'].nunique()} posting routes")
    print(df["posted_via"].value_counts(dropna=False).to_string())

    # A tweet whose client is missing cannot be placed on the route axis the
    # visualization is built around, so it is labelled rather than dropped.
    df["posted_via"] = df["posted_via"].fillna("Unknown")

    raw_locations = df["user_location"].nunique()
    df["country"] = df["user_location"].map(to_country)
    resolved = df["country"].notna().mean()
    print(f"\nstandardised 'user_location': {raw_locations} raw strings -> "
          f"country resolved for {100 * resolved:.0f}% of tweets")

    df["hashtags"] = df["hashtags"].map(tidy_text)

    print(f"\n{before:,} raw rows -> {len(df):,} cleaned rows")
    return df


# ---------------------------------------------------------------------------
# Keep tweets an English-language model can actually score
# ---------------------------------------------------------------------------

def english_only(df):
    """Drop the small number of clearly non-English tweets.

    The sentiment model is trained on English, so a Malayalam or Spanish tweet
    would still be given a confident-looking score that means nothing. There is
    no language column in this dataset and no language-detection package
    installed, so two conservative tests stand in for one:

      1. most of the tweet's letters are outside the Latin alphabet; or
      2. another language's stop words clearly outnumber English's.

    Both are deliberately strict, because a wrong guess here throws away a
    perfectly good English tweet. The rule is approximate, and the report below
    states exactly how many tweets it removed.
    """
    rule("Language -- keep what an English model can score")

    from nltk.corpus import stopwords

    english = set(stopwords.words("english"))
    others = {
        language: set(stopwords.words(language))
        for language in [
            "spanish", "french", "portuguese", "german", "italian", "dutch",
            "indonesian", "turkish", "russian", "arabic",
        ]
    }

    def strip_markup(text):
        text = re.sub(r"https?://\S+|www\.\S+", " ", str(text))
        return re.sub(r"[@#]\w+", " ", text)

    def non_latin_share(text):
        letters = [c for c in strip_markup(text) if c.isalpha()]
        if not letters:
            return 0.0
        foreign = sum(
            1 for c in letters if "LATIN" not in unicodedata.name(c, "")
        )
        return foreign / len(letters)

    def looks_foreign(text):
        if non_latin_share(text) > 0.50:
            return True

        tokens = re.findall(r"\w+", strip_markup(text).lower())
        english_hits = sum(word in english for word in tokens)
        other_hits = max(
            (sum(word in words for word in tokens) for words in others.values()),
            default=0,
        )
        # A clear margin is required, so that an English headline written
        # mostly in hashtags is not mistaken for another language.
        return other_hits >= english_hits + 2 and other_hits >= 3

    foreign = df["text"].map(looks_foreign)
    print(f"removed {foreign.sum()} tweets "
          f"({100 * foreign.mean():.2f}%) as not English")

    return df.loc[~foreign].copy()


# ---------------------------------------------------------------------------
# Part A, Tasks 7-10 -- preprocess, prune, DTM, TF-IDF
# ---------------------------------------------------------------------------

def normalize_tweet(text):
    """Task 7.1 -- fold away the parts that carry no term meaning."""
    text = str(text).lower()
    text = re.sub(r"https?://\S+|www\.\S+", " URL ", text)
    text = re.sub(r"@\w+", " USER ", text)
    text = re.sub(r"\b\d+(?:[.,]\d+)?\b", " NUMBER ", text)
    return re.sub(r"\s+", " ", text).strip()


def build_tfidf(df):
    """Turn the cleaned text into a pruned DTM and a TF-IDF matrix."""
    rule("Part A, Tasks 7-10 -- preprocessing, DTM and TF-IDF")

    from nltk.corpus import stopwords
    from nltk.stem import WordNetLemmatizer
    from nltk.tokenize import word_tokenize
    from sklearn.feature_extraction.text import (
        CountVectorizer, TfidfVectorizer,
    )

    stop_words = set(stopwords.words("english"))
    # These are the search terms the dataset was collected on, so they sit in
    # nearly every tweet and separate nothing.
    stop_words |= {"covid", "covid19", "coronavirus", "url", "user", "number",
                   "amp", "rt"}

    lemmatizer = WordNetLemmatizer()

    df["text_normalized"] = df["text"].map(normalize_tweet)
    df["tokens"] = df["text_normalized"].map(word_tokenize)

    # normalize_tweet writes URL / USER / NUMBER in capitals so that they stand
    # out when text_normalized is read by eye. Case is folded back here, before
    # the stop-word test, or those three placeholders slip past a lower-case
    # stop-word list and end up among the most characteristic terms.
    df["tokens_no_stop"] = df["tokens"].map(
        lambda tokens: [
            token for token in (t.lower() for t in tokens)
            if token not in stop_words
        ]
    )
    df["tokens_clean"] = df["tokens_no_stop"].map(
        lambda tokens: [
            lemmatizer.lemmatize(t) for t in tokens
            if t.isalpha() and len(t) > 2 and t not in stop_words
        ]
    )
    df["text_clean"] = df["tokens_clean"].str.join(" ")

    print("example of the preprocessing:")
    example = df.loc[df["text_clean"].str.len() > 40].iloc[0]
    print(f"  raw   : {example['text'][:96]}")
    print(f"  clean : {example['text_clean'][:96]}")

    # Task 8/9 -- prune the vocabulary, then count it.
    counter = CountVectorizer(min_df=MIN_DF, max_df=MAX_DF)
    dtm = counter.fit_transform(df["text_clean"])
    print(f"\nDTM: {dtm.shape[0]:,} tweets x {dtm.shape[1]:,} terms "
          f"(min_df={MIN_DF}, max_df={MAX_DF})")
    print(f"  density: {100 * dtm.nnz / (dtm.shape[0] * dtm.shape[1]):.2f}% "
          f"non-zero -- kept sparse rather than expanded to a DataFrame")

    # Task 10 -- TF-IDF over the same pruned vocabulary.
    tfidf_vectorizer = TfidfVectorizer(min_df=MIN_DF, max_df=MAX_DF)
    tfidf = tfidf_vectorizer.fit_transform(df["text_clean"])
    print(f"TF-IDF: {tfidf.shape[0]:,} x {tfidf.shape[1]:,}")

    return df, tfidf, tfidf_vectorizer.get_feature_names_out()


def characteristic_terms(tfidf, terms, labels, top_n):
    """Mean TF-IDF per term within each sentiment class.

    Averaging the TF-IDF column over the tweets of one class gives the terms
    that are both frequent in that class and rare across the corpus, which is
    what makes them characteristic of it.
    """
    import numpy as np

    rows = []
    for label in sorted(labels.unique()):
        mask = (labels == label).to_numpy()
        means = np.asarray(tfidf[mask].mean(axis=0)).ravel()

        for index in means.argsort()[::-1][:top_n]:
            rows.append({
                "sentiment": label,
                "term": terms[index],
                "mean_tfidf": round(float(means[index]), 5),
            })

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Part B, Tasks 11-12 -- RoBERTa sentiment
# ---------------------------------------------------------------------------

def prepare_for_roberta(text):
    """Task 12.1 -- lighter than the TF-IDF path, on purpose.

    Capitalisation, punctuation, emoji and negation all carry sentiment, so
    only the two things the model was trained to see as placeholders are
    replaced.
    """
    text = re.sub(r"@\w+", "@user", str(text))
    text = re.sub(r"https?://\S+|www\.\S+", "http", text)
    return text.strip()


def add_sentiment(df):
    rule("Part B, Tasks 11-12 -- RoBERTa sentiment")

    from transformers import pipeline

    model_name = "cardiffnlp/twitter-roberta-base-sentiment-latest"
    print(f"model: {model_name}")

    classifier = pipeline(
        "sentiment-analysis",
        model=model_name,
        top_k=None,
        framework="pt",
    )

    df["sentiment_text"] = df["text"].map(prepare_for_roberta)

    print(f"scoring {len(df):,} tweets on CPU -- this takes a few minutes")
    results = classifier(
        df["sentiment_text"].tolist(),
        truncation=True,
        max_length=MAX_TOKENS,
        batch_size=SENTIMENT_BATCH,
    )

    scores = [
        {item["label"].lower(): item["score"] for item in row}
        for row in results
    ]

    for label in ["negative", "neutral", "positive"]:
        df[f"p_{label}"] = [round(row.get(label, 0.0), 4) for row in scores]

    df["sentiment"] = [
        max(row, key=row.get).capitalize() for row in scores
    ]

    # Task 12.4 -- one continuous score, roughly -1 (negative) to 1 (positive).
    df["sentiment_score"] = (df["p_positive"] - df["p_negative"]).round(4)

    # Extension -- how sure was the model? The winning probability is the
    # model's confidence; the gap to the runner-up says whether two classes
    # were nearly tied.
    top_two = [sorted(row.values(), reverse=True)[:2] for row in scores]
    df["confidence"] = [round(pair[0], 4) for pair in top_two]
    df["margin"] = [round(pair[0] - pair[1], 4) for pair in top_two]

    print("\npredicted sentiment:")
    counts = df["sentiment"].value_counts()
    for label, count in counts.items():
        print(f"  {label:<9} {count:>6,}  ({100 * count / len(df):.1f}%)")

    print(f"\nmean confidence: {df['confidence'].mean():.3f}")
    print(f"tweets below 0.50 confidence: "
          f"{(df['confidence'] < 0.50).sum():,} "
          f"({100 * (df['confidence'] < 0.50).mean():.1f}%)")

    return df


# ---------------------------------------------------------------------------
# Tasks 13-14 -- tidy output and the aggregates the page draws
# ---------------------------------------------------------------------------

TIDY_COLUMNS = [
    "tweet_id", "created_at", "date", "hour", "weekday",
    "user_name", "country", "posted_via", "client",
    "user_followers", "user_verified", "hashtags",
    "tweet_text", "text_clean",
    "p_negative", "p_neutral", "p_positive",
    "sentiment", "sentiment_score", "confidence", "margin",
]


def write_outputs(df, tfidf, terms):
    rule("Tasks 13-14 -- tidy data and aggregates")

    df["tweet_text"] = df["text"]

    tidy = df[TIDY_COLUMNS].copy()
    tidy.to_csv(DATA / "lab4_clean_tweets.csv", index=False)
    print(f"lab4_clean_tweets.csv       {len(tidy):>6,} rows x "
          f"{len(tidy.columns)} columns")

    print("\nvalidation -- missing values in the tidy file:")
    missing = tidy.isna().sum()
    interesting = missing[missing > 0]
    if len(interesting):
        for column, count in interesting.items():
            print(f"  {column:<16} {count:>6,}")
    else:
        print("  none")

    # The page loads this slim file rather than the full one: same rows, but
    # without the tweet text, which is most of the bytes.
    viz = df[[
        "tweet_id", "date", "hour", "weekday", "posted_via", "country",
        "sentiment", "sentiment_score", "confidence", "margin",
    ]].copy()
    viz.to_csv(DATA / "lab4_viz_tweets.csv", index=False)
    print(f"\nlab4_viz_tweets.csv         {len(viz):>6,} rows x "
          f"{len(viz.columns)} columns")

    # --- Sentiment by posting route (the main visualization) ---------------
    by_client = (
        df.groupby(["posted_via", "sentiment"])
        .size()
        .reset_index(name="count")
    )

    totals = df.groupby("posted_via").agg(
        total=("tweet_id", "size"),
        mean_score=("sentiment_score", "mean"),
        mean_confidence=("confidence", "mean"),
    ).reset_index()

    by_client = by_client.merge(totals, on="posted_via")
    by_client["share"] = (by_client["count"] / by_client["total"]).round(4)
    by_client["mean_score"] = by_client["mean_score"].round(4)
    by_client["mean_confidence"] = by_client["mean_confidence"].round(4)
    by_client.to_csv(DATA / "lab4_sentiment_by_client.csv", index=False)

    print(f"lab4_sentiment_by_client.csv {len(by_client):>5,} rows")
    print("\nmean sentiment score by posting route:")
    for _, row in totals.sort_values("mean_score").iterrows():
        print(f"  {row['posted_via']:<22} {row['mean_score']:+.3f}"
              f"   (n = {row['total']:,})")

    # --- Sentiment by day --------------------------------------------------
    by_day = df.groupby(["date", "posted_via"]).agg(
        count=("tweet_id", "size"),
        mean_score=("sentiment_score", "mean"),
    ).reset_index()
    by_day["mean_score"] = by_day["mean_score"].round(4)
    by_day.to_csv(DATA / "lab4_sentiment_by_day.csv", index=False)
    print(f"\nlab4_sentiment_by_day.csv   {len(by_day):>6,} rows")

    # --- Characteristic terms per sentiment class --------------------------
    top_terms = characteristic_terms(tfidf, terms, df["sentiment"], TOP_TERMS)
    top_terms.to_csv(DATA / "lab4_top_terms.csv", index=False)
    print(f"lab4_top_terms.csv          {len(top_terms):>6,} rows")

    for label in sorted(df["sentiment"].unique()):
        words = top_terms.loc[top_terms["sentiment"] == label, "term"]
        print(f"  {label:<9} {', '.join(words.head(10))}")

    # --- Optional extension: where the model is least sure ------------------
    uncertain = (
        df.loc[df["margin"] < 0.15,
               ["tweet_id", "tweet_text", "posted_via",
                "p_negative", "p_neutral", "p_positive",
                "sentiment", "sentiment_score", "confidence", "margin"]]
        .sort_values("margin")
        .head(40)
    )
    uncertain.to_csv(DATA / "lab4_uncertain_tweets.csv", index=False)
    print(f"lab4_uncertain_tweets.csv   {len(uncertain):>6,} rows")

    return df


def report_confidence(df):
    """Optional extension -- describe where the model is and is not sure."""
    rule("Optional extension -- model confidence")

    print("confidence (probability of the winning class):")
    for low, high in [(0.0, 0.4), (0.4, 0.5), (0.5, 0.6), (0.6, 0.8),
                      (0.8, 0.9), (0.9, 1.01)]:
        band = df["confidence"].between(low, high, inclusive="left")
        print(f"  {low:.1f}-{high:.1f}  {band.sum():>6,}  "
              f"({100 * band.mean():>4.1f}%)")

    print("\nmean confidence by predicted class:")
    for label, value in df.groupby("sentiment")["confidence"].mean().items():
        print(f"  {label:<9} {value:.3f}")

    near_tie = df["margin"] < 0.15
    print(f"\nnear-ties (top two classes within 0.15): {near_tie.sum():,} "
          f"({100 * near_tie.mean():.1f}%)")

    print("\nthe five least decisive tweets:")
    for _, row in df.nsmallest(5, "margin").iterrows():
        print(f"  [{row['sentiment']}, margin {row['margin']:.3f}] "
              f"neg {row['p_negative']:.2f} / neu {row['p_neutral']:.2f} / "
              f"pos {row['p_positive']:.2f}")
        print(f"    {row['tweet_text'][:110]}")


def main():
    if not RAW_IN.exists():
        sys.exit(f"{RAW_IN} is missing -- run lab4/fetch_tweets.py first.")

    df = pd.read_csv(RAW_IN)

    inspect(df)
    df = clean_structured(df)
    df = english_only(df)

    # Settle the row order once, here. Everything downstream -- the TF-IDF
    # matrix, the sentiment scores, the saved files -- is positional, so the
    # rows must not be reordered again after this point.
    #
    # This collection carries no tweet id, so one is assigned from the
    # chronological order of the cleaned rows. It identifies a row in these
    # files; it is not Twitter's id.
    df = df.sort_values("created_at").reset_index(drop=True)
    df["tweet_id"] = [f"t{index:05d}" for index in range(len(df))]

    df, tfidf, terms = build_tfidf(df)
    df = add_sentiment(df)

    df = write_outputs(df, tfidf, terms)
    report_confidence(df)

    rule("Done")
    print(f"{len(df):,} tweets written to {DATA}")


if __name__ == "__main__":
    main()
