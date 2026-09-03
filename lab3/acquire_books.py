"""Lab 3 assignment — acquire at least 1,000 book records.

Source : https://books.toscrape.com/  (a sandbox site published for scraping
         practice; it serves 1,000 books across 50 catalogue pages)
Method : HTML scraping with requests + BeautifulSoup

The script is polite by construction: it checks robots.txt before starting,
identifies itself with a real User-Agent, sleeps between requests, and retries
a failed page.
"""

import time
import sys
from urllib.robotparser import RobotFileParser

import requests
import pandas as pd
from bs4 import BeautifulSoup

BASE = "https://books.toscrape.com/"
PAGE_URL = BASE + "catalogue/page-{page}.html"

USER_AGENT = "STATS401-Class-Exercise/1.0"
HEADERS = {"User-Agent": USER_AGENT}

FIRST_PAGE = 1
LAST_PAGE = 50          # 50 pages x 20 books = 1,000 records
DELAY_SECONDS = 1.0     # Task 9 — rate limiting
TIMEOUT = 10
MAX_RETRIES = 3

# The site encodes the rating as a word in the CSS class, e.g.
# <p class="star-rating Three">.
RATING_WORDS = {
    "One": 1,
    "Two": 2,
    "Three": 3,
    "Four": 4,
    "Five": 5,
}


def automated_access_allowed(url):
    """Task 15.1 — respect robots.txt before collecting anything.

    A site with no robots.txt has published no restriction, so a missing file
    is treated as allowed rather than as a failure.
    """
    parser = RobotFileParser()
    parser.set_url(BASE + "robots.txt")

    try:
        parser.read()
    except Exception:
        print("No robots.txt could be read; treating as unrestricted.")
        return True

    return parser.can_fetch(USER_AGENT, url)


def fetch(url):
    """Request one page, retrying briefly on transient failures.

    Returns the response, or None if the page could not be fetched.
    """
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            response.raise_for_status()
            return response

        except requests.RequestException as error:      # Task 10
            print(f"  attempt {attempt}/{MAX_RETRIES} failed: {error}")

            if attempt < MAX_RETRIES:
                # Back off further each time rather than retrying immediately.
                time.sleep(DELAY_SECONDS * attempt)

    return None


def parse_rating(article):
    """Turn <p class="star-rating Three"> into the integer 3."""
    tag = article.select_one("p.star-rating")
    if tag is None:
        return None

    for css_class in tag.get("class", []):
        if css_class in RATING_WORDS:
            return RATING_WORDS[css_class]

    return None


def parse_books(soup, page):
    """Extract every book record from one catalogue page."""
    records = []

    for article in soup.select("article.product_pod"):

        title = article.select_one("h3 a")["title"]

        price_text = article.select_one(".price_color").get_text(strip=True)
        # Strip the currency symbol; the page serves it as £ (and sometimes
        # with a stray encoding prefix), so keep only digits and the point.
        price = float("".join(c for c in price_text if c.isdigit() or c == "."))

        availability = article.select_one("p.instock.availability")
        in_stock = availability.get_text(strip=True) if availability else ""

        link = article.select_one("h3 a")["href"].replace("../", "")

        records.append({
            "title": title,
            "price_gbp": price,
            "rating": parse_rating(article),
            "availability": in_stock,
            "page": page,
            "url": BASE + "catalogue/" + link,
        })

    return records


def main():
    first_url = PAGE_URL.format(page=FIRST_PAGE)

    if not automated_access_allowed(first_url):
        print("robots.txt disallows this path. Stopping.")
        sys.exit(1)

    print(f"Scraping pages {FIRST_PAGE}-{LAST_PAGE} of {BASE}")

    records = []
    failed_pages = []

    for page in range(FIRST_PAGE, LAST_PAGE + 1):       # Task 8 — pagination

        url = PAGE_URL.format(page=page)
        response = fetch(url)

        if response is None:
            print(f"page {page:>2}: giving up after {MAX_RETRIES} attempts")
            failed_pages.append(page)
            continue

        soup = BeautifulSoup(response.text, "html.parser")
        page_records = parse_books(soup, page)
        records.extend(page_records)

        print(f"page {page:>2}: {len(page_records):>2} books "
              f"(running total {len(records)})")

        time.sleep(DELAY_SECONDS)                        # Task 9

    if failed_pages:
        print("\nPages that could not be fetched:", failed_pages)

    frame = pd.DataFrame(records)
    frame.to_csv("../data/lab3_data.csv", index=False)

    print(f"\nCollected {len(frame)} records with "
          f"{len(frame.columns)} columns -> ../data/lab3_data.csv")
    print(frame.head())


if __name__ == "__main__":
    main()
