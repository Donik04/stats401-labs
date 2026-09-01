"""Lab 3 walkthrough — Tasks 11 to 14: reading a REST API.

Run from inside the lab3/ folder:

    python api_example.py
"""

import requests
import pandas as pd

URL = "https://jsonplaceholder.typicode.com/posts"


# --- Task 11: request JSON instead of HTML -------------------------------

response = requests.get(URL, timeout=10)
response.raise_for_status()

data = response.json()

print(type(data))
print("Records returned:", len(data))
print("First record:", data[0])


# --- Task 12: select only the fields we need -----------------------------

first_post = data[0]
print("\nid:   ", first_post["id"])
print("title:", first_post["title"])

records = []

for post in data:
    records.append({
        "id": post["id"],
        "user_id": post["userId"],
        "title": post["title"],
    })

frame = pd.DataFrame(records)
frame.to_csv("../data/posts.csv", index=False)
print("\nSaved ../data/posts.csv")
print(frame.head())


# --- Task 13: query parameters -------------------------------------------

params = {"userId": 1}

filtered = requests.get(URL, params=params, timeout=10)
filtered.raise_for_status()

print("\nRequest URL with parameters:", filtered.url)
print("Posts by user 1:", len(filtered.json()))
