"""Lab 3 walkthrough — Tasks 2 to 10: HTML scraping with requests + BeautifulSoup.

Run from inside the lab3/ folder:

    python scrape_example.py
"""

import time

import requests
import pandas as pd
from bs4 import BeautifulSoup

URL = "https://books.toscrape.com/"
HEADERS = {"User-Agent": "STATS401-Class-Exercise/1.0"}   # Task 2.3


# --- Task 2: a GET request and its status code ---------------------------

response = requests.get(URL, headers=HEADERS, timeout=10)
response.raise_for_status()

print("Status code:", response.status_code)
print("Request successful")


# --- Tasks 4 and 5: parse the HTML, then select with CSS selectors -------

soup = BeautifulSoup(response.text, "html.parser")

books = soup.select("article.product_pod")
print("Books on page:", len(books))

first = books[0]
print("First title:", first.select_one("h3 a")["title"])
print("First price:", first.select_one(".price_color").get_text(strip=True))


# --- Task 6: extract every record on the page ----------------------------

records = []

for book in books:

    title = book.select_one("h3 a")["title"]
    price_text = book.select_one(".price_color").get_text(strip=True)
    price = float("".join(c for c in price_text if c.isdigit() or c == "."))

    records.append({"title": title, "price": price})

print("\nFirst three records:")
for record in records[:3]:
    print(" ", record)


# --- Task 7: save the result --------------------------------------------

frame = pd.DataFrame(records)
print("\n", frame.head(), sep="")

frame.to_csv("../data/books.csv", index=False)
frame.to_json("../data/books.json", orient="records", indent=2)
print("\nSaved ../data/books.csv and ../data/books.json")


# --- Tasks 8, 9, 10: pagination, rate limiting and error handling --------

paged_records = []

for page in range(1, 6):

    page_url = f"https://books.toscrape.com/catalogue/page-{page}.html"

    try:
        page_response = requests.get(page_url, headers=HEADERS, timeout=10)
        page_response.raise_for_status()

    except requests.RequestException as error:           # Task 10
        print(f"Failed on page {page}:", error)
        continue

    page_soup = BeautifulSoup(page_response.text, "html.parser")

    for book in page_soup.select("article.product_pod"):
        paged_records.append({
            "title": book.select_one("h3 a")["title"],
            "price": book.select_one(".price_color").get_text(strip=True),
            "page": page,
        })

    print("Downloaded page", page)
    time.sleep(1)                                        # Task 9

print("Total records across 5 pages:", len(paged_records))
