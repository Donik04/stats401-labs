"""Lab 8 step 1 -- turn the DKU Undergraduate Bulletin PDF into passages.

Source : Bulletin of Duke Kunshan University Undergraduate Instruction
         2021-2022 (July 2021, 400 pages)
         https://dku-web-admissions.s3.cn-north-1.amazonaws.com.cn/dkumain/files/V2021-22_DKU_UG_Bulletin.pdf
Output : data/lab8_bulletin_passages.csv
         passage_id, chapter, section, subsection, heading, page, text

The PDF's own outline (bookmarks) gives the hierarchy: level 1 is a Part
(chapter), level 2 a section, level 3 a subsection, levels 4-5 and unlisted
bold lines are kept as `heading`. Each text block PyMuPDF returns is roughly
one paragraph; short blocks (list items, table rows, calendar lines) are
grouped until the next heading, and long ones are split at sentences so that
no passage is truncated by the embedding model.
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
CACHE = HERE / ".cache"
PDF = CACHE / "V2021-22_DKU_UG_Bulletin.pdf"
URL = ("https://dku-web-admissions.s3.cn-north-1.amazonaws.com.cn/"
       "dkumain/files/V2021-22_DKU_UG_Bulletin.pdf")
OUT = DATA / "lab8_bulletin_passages.csv"

FIRST_PAGE = 10          # pages 1-9: cover, editors, table of contents
SKIP_CHAPTERS = {"Part 12: Useful Contacts"}   # an e-mail directory, not prose
FOOTER_Y = 735           # printed page number sits below this line
SHORT_BLOCK = 25         # words; shorter blocks are grouped, not stand-alone
GROUP_LIMIT = 120        # stop growing a group of short blocks here
MAX_WORDS = 180          # MiniLM reads ~256 word-pieces, so split above this
MIN_WORDS = 8

COURSE_CODE = re.compile(r"^[A-Z]{2,10}\s*\d{2,3}[A-Z]{0,2}\b")
CREDITS = re.compile(r"\(\s*[\d.\-–]+\s*credits?\b[^)]*\)", re.I)


def is_course_title(text, section):
    """A bold "BIOL 309 Comparative Vertebrate Anatomy (4 credits)" line.
    Inside Course Descriptions a few titles omit the credit count."""
    return bool(COURSE_CODE.match(text)) and (section == "Course Descriptions"
                                              or bool(CREDITS.search(text)))


# "Course Code  Course Name  Course Credit", sometimes split over two blocks
TABLE_HEADER = re.compile(r"^course\s+(code|name|credit)\b", re.I)
LIST_LEAD = re.compile(r"^(choose|and|or|select|complete|plus)\b", re.I)


def norm(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def clean_title(title):
    title = re.sub(r"\d+F$", "", title).strip()          # footnote anchors
    title = title.replace("Courses with Course Subject: ", "")
    title = title.replace(" (listed in alphabetical order)", "")
    return re.sub(r"\s+", " ", title)


def line_info(spans):
    # superscript footnote markers are set in 6.5-7pt type inside body text
    body = [s for s in spans if s["text"].strip() and s["size"] >= 8]
    text = re.sub(r"\s+", " ", " ".join(s["text"] for s in body)).strip()
    # Palatino roman sets the outline's level-5 headings ("Electives"), but
    # also figure labels, so it only counts as bold for outline matching
    bold = bool(body) and all("Bold" in s["font"] or "Palatino" in s["font"] for s in body)
    strong = bool(body) and all("Bold" in s["font"] for s in body)
    return text, bold, max((s["size"] for s in body), default=0), strong


def block_lines(block):
    """The block's lines as (text, bold, size, strong), plus whether it opens in
    footnote-sized type."""
    lines = [line_info(line["spans"]) for line in block["lines"]]
    lines = [ln for ln in lines if ln[0]]
    first = [s for line in block["lines"] for s in line["spans"] if s["text"].strip()]
    small_start = bool(first) and first[0]["size"] < 8
    return lines, small_start


def split_long(text):
    if len(text.split()) <= MAX_WORDS:
        return [text]
    sentences = re.split(r"(?<=[.!?;])\s+(?=[A-Z(•\d])", text)
    chunks, current = [], []
    for sentence in sentences:
        if current and len(" ".join(current + [sentence]).split()) > MAX_WORDS:
            chunks.append(" ".join(current))
            current = []
        current.append(sentence)
    if current:
        chunks.append(" ".join(current))
    # a trailing fragment is folded back rather than left as its own passage
    if len(chunks) > 1 and len(chunks[-1].split()) < 30:
        tail = chunks.pop()
        chunks[-1] += " " + tail
    return chunks


def main():
    if not PDF.exists():
        CACHE.mkdir(exist_ok=True)
        print(f"downloading {URL}")
        urllib.request.urlretrieve(URL, PDF)

    doc = pymupdf.open(PDF)
    # (level, title as stored, title as printed on the page, page)
    toc = [(lvl, clean_title(title), re.sub(r"\d+F$", "", title), page)
           for lvl, title, page in doc.get_toc()]
    print(f"pages: {doc.page_count}, outline entries: {len(toc)}")

    has_sections = {toc[i][1] for i in range(len(toc) - 1)
                    if toc[i][0] == 1 and toc[i + 1][0] == 2}
    path = {1: "", 2: "", 3: "", 4: "", 5: ""}
    minor = ""
    toc_pos = 0
    raw, buf = [], None
    dropped = {"footer": 0, "table header": 0, "footnote": 0}

    def flush():
        nonlocal buf
        if buf and buf["text"].strip():
            raw.append(buf)
        buf = None

    def start(text, page, prefix=""):
        nonlocal buf
        flush()
        heading = minor or path[5] or path[4] or ""
        # text before a Part's first section is its introduction; a Part with
        # no sections at all (the calendar) is its own single section
        section = path[2] or ("Introduction" if path[1] in has_sections
                              else path[1].split(": ", 1)[-1])
        buf = {"chapter": path[1], "section": section,
               "subsection": path[3],
               "heading": heading, "page": page,
               "text": (prefix + text).strip(), "short": len(text.split()) < SHORT_BLOCK}

    for pno in range(FIRST_PAGE - 1, doc.page_count):
        page = pno + 1
        for block in doc[pno].get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            lines, small_start = block_lines(block)
            if not lines:
                continue
            text = " ".join(ln[0] for ln in lines)
            if block["bbox"][1] > FOOTER_Y and re.fullmatch(r"\d{1,3}", text):
                dropped["footer"] += 1
                continue
            if small_start and max(ln[2] for ln in lines) <= 10:
                dropped["footnote"] += 1
                continue
            if TABLE_HEADER.match(text):
                dropped["table header"] += 1
                continue

            # 1. outline headings. A heading can share a block with the
            #    paragraph under it, so they are peeled off line by line.
            #    Entries more than a page behind are skipped, so one heading
            #    the PDF sets differently cannot stall the pointer.
            #    The outline also lists every course; those titles open a
            #    course passage instead (rule 2).
            while toc_pos < len(toc) and toc[toc_pos][3] < page - 1:
                toc_pos += 1
            while lines and lines[0][1] and not is_course_title(lines[0][0], path[2]):
                hit = None
                for k in range(toc_pos, len(toc)):
                    lvl, _, printed, tpage = toc[k]
                    if tpage > page + 1:
                        break
                    if norm(printed)[:40] == norm(lines[0][0])[:40]:
                        hit = k
                        break
                if hit is None:
                    break
                flush()
                lvl, title, printed, _ = toc[hit]
                used = 1   # a long title can wrap onto a second bold line
                while (used < len(lines) and lines[used][1] and
                       norm(printed).startswith(norm(" ".join(ln[0] for ln in lines[:used + 1])))):
                    used += 1
                lines = lines[used:]
                path[lvl] = title
                for deeper in range(lvl + 1, 6):
                    path[deeper] = ""
                minor = ""
                toc_pos = hit + 1
            if not lines:
                continue
            text = " ".join(ln[0] for ln in lines)
            bold = all(ln[1] for ln in lines)
            strong = all(ln[3] for ln in lines)

            if path[1] in SKIP_CHAPTERS or not path[1]:
                continue

            # 2. a course description starts at its bold title line
            if bold and is_course_title(text, path[2]):
                start(text + ".", page)
                buf["heading"] = text
                buf["short"] = False
                continue

            # 3. any other bold line is an unlisted sub-heading, unless it is
            #    an instruction inside a course table ("Choose one from ...")
            letters = len(re.findall(r"[A-Za-z]", text)) / len(text)
            if strong and len(text.split()) <= 14 and letters > 0.6 and not LIST_LEAD.match(text):
                flush()
                minor = text.rstrip(":")
                continue

            words = len(text.split())
            continues = (buf is not None and not re.search(r"[.:;?!)\"”]$", buf["text"])
                         and re.match(r"^[a-z(]", text))
            if buf is not None and (continues or
                                    (buf["short"] and words < SHORT_BLOCK
                                     and len(buf["text"].split()) < GROUP_LIMIT) or
                                    (path[2] == "Course Descriptions" and COURSE_CODE.match(buf["text"]))):
                buf["text"] += " " + text
                continue
            start(text, page, prefix=(minor + ": ") if (minor and words < SHORT_BLOCK) else "")

    flush()

    rows = []
    for p in raw:
        for chunk in split_long(p["text"]):
            rows.append({k: p[k] for k in ("chapter", "section", "subsection", "heading", "page")}
                        | {"text": chunk})
    df = pd.DataFrame(rows)
    print(f"raw passages: {len(df):,}  (dropped blocks: {dropped})")

    # --- cleaning ---------------------------------------------------------
    df["text"] = (df["text"]
                  .str.replace(" ", " ", regex=False)
                  .str.replace(r"\s*•\s*", " • ", regex=True)
                  .str.replace(r"\s+", " ", regex=True)
                  .str.replace(r"^\s*•\s*", "", regex=True)
                  .str.strip())
    # course tables read "MATH 101 Introductory Calculus 4": the trailing
    # credit count becomes a separator between courses
    df["text"] = df["text"].str.replace(
        r"\s+\d(?:\.\d)?(?=\s+(?:[A-Z]{2,10}\s*\d{3}|And |Or |Choose )|$)", ";", regex=True)
    n0 = len(df)
    df = df.dropna(subset=["text"])
    df = df[df["text"].str.split().str.len() >= MIN_WORDS]
    n_short = n0 - len(df)
    alpha = df["text"].str.count(r"[A-Za-z]") / df["text"].str.len()
    n_malformed = int((alpha < 0.5).sum())
    df = df[alpha >= 0.5]
    n1 = len(df)
    df = df.drop_duplicates(subset=["text"])
    print(f"removed: {n_short} under {MIN_WORDS} words, {n_malformed} mostly "
          f"non-alphabetic (tables of figures), {n1 - len(df)} exact duplicates")

    df = df.fillna("").reset_index(drop=True)
    df.insert(0, "passage_id", [f"p{i + 1:04d}" for i in range(len(df))])
    df.to_csv(OUT, index=False, encoding="utf-8")
    print(f"clean passages: {len(df):,} -> {OUT.name}")
    print(df.groupby("chapter", sort=False).size().to_string())


if __name__ == "__main__":
    main()
