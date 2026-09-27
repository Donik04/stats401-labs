"""Lab 8 step 2 -- embeddings, UMAP, topics and the files the page loads.

Input  : data/lab8_bulletin_passages.csv   (from build_corpus.py)
Outputs: data/lab8_embedding_map.csv        one row per passage, with x, y,
                                            topic, 5 nearest neighbours and
                                            similarity to its section centroid
         data/lab8_topic_section_matrix.csv section x topic counts
         data/lab8_topics.csv               topic labels, TF-IDF terms, examples
         data/lab8_section_summary.csv      per-section size, length, diversity
         data/lab8_top_terms.csv            corpus-wide top TF-IDF terms

Embeddings: all-MiniLM-L6-v2 (384-d, normalised). Topics: k-means (k = 8) on
the 384-d vectors, not on the 2-D map. UMAP is only for drawing.
"""

import os
import sys
from pathlib import Path

# transformers probes for TensorFlow at import time and this machine's TF is
# incompatible with its Keras 3, so the framework is pinned to PyTorch (Lab 4).
os.environ["USE_TF"] = "0"
os.environ["USE_TORCH"] = "1"

import numpy as np
import pandas as pd
import umap
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.metrics import silhouette_score

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data"
SEED = 401
K = 8
NEAR_DUP = 0.97       # cosine; the same course table repeated for each track
N_NEIGHBOURS = 5

# Words on nearly every page of a bulletin: they say nothing about a topic.
DOMAIN_STOP = {"course", "courses", "student", "students", "prerequisite",
               "prerequisites", "credit", "credits", "dku", "duke", "kunshan",
               "university", "introduction", "consent", "instructor", "will",
               "including", "topics"}

# Assigned after reading each cluster's TF-IDF terms and the passages nearest
# its centroid (printed below). k-means with SEED is deterministic, so the ids
# are stable across runs of this script on the same corpus.
TOPIC_NAMES = {
    0: "Arts, Media & Literature",
    1: "China, Chinese & Languages",
    2: "Life & Environmental Sciences",
    3: "Math, Computing & Physics",
    4: "Credits, Grades & Transfer",
    5: "Mission, Programs & Support",
    6: "Politics, Society & History",
    7: "Enrollment, Leave & Withdrawal",
}


def rule(title):
    print(f"\n{'=' * 68}\n{title}\n{'=' * 68}")


def main():
    df = pd.read_csv(DATA / "lab8_bulletin_passages.csv").fillna("")
    df["text_clean"] = df["text"].str.replace(r"\s+", " ", regex=True).str.strip()
    df["word_count"] = df["text_clean"].str.split().str.len()

    rule("Task 6 -- embeddings")
    model = SentenceTransformer("all-MiniLM-L6-v2")
    emb = model.encode(df["text_clean"].tolist(), normalize_embeddings=True,
                       batch_size=64, show_progress_bar=False)
    print("embeddings:", emb.shape)

    # near-duplicates: identical requirement tables listed under every track
    sim = emb @ emb.T
    keep = np.ones(len(df), dtype=bool)
    for i in range(len(df)):
        if keep[i]:
            dup = np.where(sim[i, i + 1:] >= NEAR_DUP)[0] + i + 1
            keep[dup] = False
    print(f"near-duplicates removed (cosine >= {NEAR_DUP}): {(~keep).sum()}")
    df = df[keep].reset_index(drop=True)
    emb = emb[keep]
    print(f"passages analysed: {len(df):,}")
    print(df["word_count"].describe().round(1).to_string())

    rule("Task 7 -- semantic similarity (first passage)")
    sim = emb @ emb.T
    np.fill_diagonal(sim, -1)
    j = int(np.argmax(sim[0]))
    print(df.at[0, "text_clean"][:160], "\n->", df.at[j, "text_clean"][:160],
          f"\nsimilarity: {sim[0, j]:.3f}")
    order = np.argsort(-sim, axis=1)[:, :N_NEIGHBOURS]
    df["neighbors"] = [
        "|".join(f"{df.at[n, 'passage_id']}:{sim[i, n]:.3f}" for n in row)
        for i, row in enumerate(order)]

    rule("Task 8 -- UMAP")
    reducer = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.15,
                        metric="cosine", random_state=SEED)
    coords = reducer.fit_transform(emb)
    df["x"], df["y"] = coords[:, 0].round(4), coords[:, 1].round(4)

    rule("Task 9 -- k-means topics")
    for k in range(6, 15):
        labels = KMeans(k, random_state=SEED, n_init="auto").fit_predict(emb)
        print(f"k={k:>2}  silhouette (cosine) {silhouette_score(emb, labels, metric='cosine'):.3f}")
    km = KMeans(K, random_state=SEED, n_init="auto").fit(emb)
    df["cluster"] = km.labels_
    df["cluster_name"] = df["cluster"].map(TOPIC_NAMES)

    vec = TfidfVectorizer(stop_words=list(ENGLISH_STOP_WORDS | DOMAIN_STOP),
                          token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z]+\b",
                          min_df=3, max_df=0.5, sublinear_tf=True)
    tfidf = vec.fit_transform(df["text_clean"])
    terms = np.array(vec.get_feature_names_out())

    topics = []
    for c in range(K):
        mask = (df["cluster"] == c).to_numpy()
        top = terms[np.argsort(-np.asarray(tfidf[mask].mean(0)).ravel())[:10]]
        centre = km.cluster_centers_[c] / np.linalg.norm(km.cluster_centers_[c])
        idx = np.where(mask)[0][np.argsort(-(emb[mask] @ centre))[:3]]
        print(f"\nCLUSTER {c} -> {TOPIC_NAMES[c]}  (n={mask.sum()})\n  terms: {', '.join(top)}")
        for i in idx:
            print("   -", df.at[i, "text_clean"][:140])
        topics.append({"cluster": c, "cluster_name": TOPIC_NAMES[c],
                       "passages": int(mask.sum()), "top_terms": ", ".join(top),
                       "examples": "|".join(df.loc[idx, "passage_id"])})

    # how typical is each passage of the section it sits in?
    df["section_key"] = df["chapter"] + " / " + df["section"]
    df["section_fit"] = 0.0
    summary = []
    for key, idx in df.groupby("section_key").groups.items():
        idx = np.asarray(idx)
        centre = emb[idx].mean(0)
        centre /= np.linalg.norm(centre)
        fit = emb[idx] @ centre
        df.loc[idx, "section_fit"] = fit.round(3)
        share = df.loc[idx, "cluster"].value_counts(normalize=True)
        summary.append({"chapter": df.at[idx[0], "chapter"], "section": df.at[idx[0], "section"],
                        "passages": len(idx),
                        "mean_words": round(df.loc[idx, "word_count"].mean(), 1),
                        "topics": int(share.size),
                        "topic_entropy": round(float(-(share * np.log2(share)).sum()), 3),
                        "dispersion": round(float(1 - fit.mean()), 3)})
    summary = pd.DataFrame(summary)

    rule("Task 10 / 14 -- exports")
    cols = ["passage_id", "chapter", "section", "subsection", "heading", "page",
            "text", "word_count", "cluster", "cluster_name", "x", "y",
            "neighbors", "section_fit"]
    df[cols].to_csv(DATA / "lab8_embedding_map.csv", index=False, encoding="utf-8")

    matrix = (df.groupby(["chapter", "section", "cluster_name"], sort=False)
              .size().reset_index(name="count"))
    matrix["proportion"] = (matrix["count"] /
                            matrix.groupby(["chapter", "section"])["count"].transform("sum")).round(4)
    matrix.to_csv(DATA / "lab8_topic_section_matrix.csv", index=False, encoding="utf-8")
    pd.DataFrame(topics).to_csv(DATA / "lab8_topics.csv", index=False, encoding="utf-8")
    summary.to_csv(DATA / "lab8_section_summary.csv", index=False, encoding="utf-8")

    overall = np.asarray(tfidf.sum(0)).ravel()
    top = np.argsort(-overall)[:20]
    pd.DataFrame({"term": terms[top], "tfidf": overall[top].round(2),
                  "passages": np.asarray((tfidf[:, top] > 0).sum(0)).ravel()}
                 ).to_csv(DATA / "lab8_top_terms.csv", index=False, encoding="utf-8")

    print(f"passages {len(df):,}, sections {df['section_key'].nunique()}, "
          f"chapters {df['chapter'].nunique()}, matrix cells {len(matrix)}")
    print("\nmost diverse sections (>= 5 passages):")
    print(summary[summary.passages >= 5].sort_values("topic_entropy", ascending=False)
          .head(8)[["section", "passages", "topics", "topic_entropy", "dispersion"]].to_string(index=False))


if __name__ == "__main__":
    main()
