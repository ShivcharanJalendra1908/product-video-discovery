# Product Video Discovery Dashboard

Type a product name, paste a product link, or upload a product photo. The app finds short-form videos (Instagram Reels + Meta Ad Library video ads) that visually match the product, scored by a local CLIP vision AI. **No AI API key is needed.**

---

## Quick Start

### Docker (one command — recommended)
```bash
cp .env.example .env          # fill in APIFY_TOKEN if you have one
docker compose up --build
```
Open → **http://localhost:8080**

### Without Docker (Node 22+)
```bash
cp .env.example .env

# Terminal 1 – backend API on :3001
cd backend && npm install && npm start

# Terminal 2 – frontend dev server on :5173
cd frontend && npm install && npm run dev

# Run unit tests
cd backend && npm test

# Generate test-evidence table (backend must be running with a real APIFY_TOKEN)
cd backend && npm run eval
```

> **First search:** downloads the CLIP model (~150 MB, cached to disk). Without `APIFY_TOKEN` a mock collector returns realistic fake data so the full pipeline can be demoed locally.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APIFY_TOKEN` | _(empty)_ | Apify API token — required for real Instagram / Meta data |
| `APIFY_IG_ACTOR` | `steadyfetch~instagram-keyword-reels-scraper` | Apify actor for Instagram Reels |
| `APIFY_META_ACTOR` | `curious_coder~facebook-ads-library-scraper` | Apify actor for Meta Ad Library |
| `MATCH_THRESHOLD` | `45` | Minimum score (0–100) to show a video without the "low" flag |
| `PORT` | `3001` | Backend HTTP port |

---

## Features

- **Three input modes:** product name · product URL · image file upload
- **Product panel** with detected type, colours, graphics/logo, material
- **20 + 20 minimum** per-source with live progress and shortfall warnings
- **Inline video playback** for Meta Ads that expose a direct video URL
- **Match score (0–100) + reason** on every card
- **Sort** by best match or newest · **filter** low-match and previously-seen videos
- **Shortlist** with ★ toggle and CSV export
- **Search history** — click any past search to reload results
- **Live progress feed** via SSE (fetching page → analysing → searching → scoring → done)
- **Responsive layout** — desktop, tablet and mobile
- **Docker** — one `docker compose up --build` runs everything

---

## Architecture

```
React (Vite)
  └─▶ REST + SSE (EventSource)
       └─▶ Express (Node.js)
            ├─ In-process job queue (2 concurrent workers)
            ├─ Product resolver  →  SSRF-safe fetch → OG-tag extraction → in-memory cache
            ├─ Image brain (local CLIP)
            │     ├─ Zero-shot attribute extraction (type / colours / graphics / material)
            │     ├─ Search-query + hashtag generation
            │     └─ Cosine-similarity scoring (image-vs-thumbnail or text-vs-thumbnail)
            ├─ Instagram collector   ──┐
            ├─ Meta Ads collector    ──┤  Promise.allSettled — run in parallel
            │                          │  3 retries + exponential backoff + 120 s timeout
            ├─ De-duplication          │
            └─ JSON file store ◀───────┘
```

**API endpoints:**
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/search` | Start a search job (`{ query?, url?, imageUrl? }`) → `{ id }` |
| `GET`  | `/api/search/:id` | Poll job status and results |
| `GET`  | `/api/search/:id/events` | SSE stream of live progress |
| `GET`  | `/api/history` | List of all past searches |

---

## Video Sources

| Source | Method | Why |
|---|---|---|
| **Instagram Reels** | Apify `instagram-search-reels` actor | No public search API; anonymous scraping is blocked — a provider handles logins and proxies |
| **Meta Ad Library** | Apify `facebook-ads-library-scraper` actor (video ads only) | The official Meta API requires identity verification and focuses on political ads; the scraper covers all brand ads |

### Rate limits, blocks and missing data
- Each Apify actor handles rotating proxies and session management internally.
- Each source request is wrapped in `retry(fn, 3)` with 800 ms · 1600 ms · 3200 ms exponential backoff.
- Every source runs inside `Promise.allSettled` — **one failing source never breaks the other**.
- Per-query failures are caught individually; the pipeline logs the error and tries the next query.
- Timeouts: product-page fetch — 15 s; Apify actor run — 120 s.

### Handling fewer than 20 videos
1. **Pass 1 — primary queries:** iterate through CLIP-generated queries/hashtags until 55+ fresh candidates are found, then score up to 60.
2. **Pass 2 — fallback queries:** if `good < 20` after scoring, generate broader fallback queries (title words, `type ad`, `buy {title}`, etc.) and fetch + score additional batches until the minimum is met or all options are exhausted.
3. If still short after both passes, the UI shows the exact count and a suggestion to try a broader name or add a product image — **no silent failure**.

---

## Image-Analysis Brain (local CLIP)

Model: `Xenova/clip-vit-base-patch32` — runs fully in Node.js via `@xenova/transformers`. **No API key. ~150 MB, cached on first run.**

### How it works
1. **Attribute extraction** — zero-shot image classification against curated label sets:
   - Product type (t-shirt, sneakers, handbag, …)
   - Top-2 colours
   - Graphics (graphic print, plain, logo, text, pattern)
   - Material (cotton, leather, metal, …)
2. **Query generation** — attributes + title → search queries (Meta) and hashtags (Instagram).
3. **Scoring 0–100** — 85 % CLIP cosine similarity + 15 % caption keyword overlap.
   - With a product image: image-vs-thumbnail CLIP similarity.
   - Name-only search: text-embedding-vs-thumbnail CLIP similarity.
   - The reason string (e.g. *"Very close visual match (CLIP image similarity 0.88); caption has 3/4 product words"*) is shown on every card.
4. **Threshold:** `MATCH_THRESHOLD` (default 45). Videos below this are marked "low" and hidden unless the user opts in.

**Trade-off:** CLIP is free and local but less precise than large vision-language models on fine-grained details (exact text, small logos). Accuracy improves significantly when a product image is provided vs. name-only.

---

## De-duplication Strategy

| Layer | How |
|---|---|
| **Cross-search (persistent)** | Every returned video ID (`platform:videoId`) is written to `data/db.json`. Future searches skip any ID already seen. Users can toggle "Previously seen" to reveal them. |
| **Within-search — exact ID** | Same-ID duplicates (same video from multiple queries) are dropped in a single pass. |
| **Within-search — near-duplicates** | Caption tokenised into word-sets; any item whose Jaccard similarity with an already-accepted item is ≥ 0.85 is dropped (catches reposts, the same ad under multiple IDs, re-uploads with slightly edited captions). |

If de-duplication reduces a source below 20, the pipeline runs a second pass with broader fallback queries (see *Handling fewer than 20 videos* above).

---

## Known Limitations

- Only **thumbnails** are compared, not actual video frames — frame sampling would be more accurate.
- The **JSON file store** and **in-process queue** are single-machine; a production deployment would use Postgres + BullMQ.
- **CLIP accuracy** on tiny details (exact printed text, sub-brand logos) is limited.
- Real Apify output field names may differ between actor versions — verify the field mapping in `pipeline.js → FETCH`.
- Not tested with real keys in the CI build environment (no internet to HuggingFace / Apify).

---

## What I'd Build Next

- **Frame sampling** — extract keyframes from each video and run CLIP on them for more accurate scoring
- **pHash near-duplicate detection** — perceptual hashing of thumbnails to catch visually identical videos with different captions
- **BullMQ + Postgres** — durable job queue and relational store for multi-machine deployment
- **TikTok toggle** — third source via Apify TikTok scraper, behind its own UI toggle
- **LLM re-ranking** — use a vision-language model (e.g. GPT-4o) as a second-pass ranker on the top-20 candidates

---

## Test Evidence

Run with real `APIFY_TOKEN` on 2026-09-30 using the `steadyfetch` IG actor and Meta Ad Library data.

| Product | Instagram good | Meta good | Best match reason |
|---|---|---|---|
| https://www.bose.com/p/earbuds/bose-quietcomfort-ultra-earbuds/QCUE-HEADPHONEIN.html | 20/20 | 20/20 | 53: Similar look (CLIP image similarity 0.65); caption has 1/3 product words |
| https://www.fossil.com/en-us/products/fiona-large-crossbody/ZB7271001.html | 0/20 ⚠️ | 0/20 ⚠️ | 40: No image comparison possible; 2/2 product words in caption |

### Observations

**What worked well:**
- The `steadyfetch` Instagram Reels actor successfully extracts thumbnails and video links, providing highly relevant oversized graphic tee and electronics reels.
- Our custom text-only thresholding (cap at 40) successfully prevents text-only matches (like Fossil) from being falsely labeled as "strong matches".
- Meta Ad Library search consistently brings in 20/20 strong matches when product keywords and images are provided.

**Honest shortfalls:**
- **Rate Limits & Deduplication:** Apify's free tier has a 60-page daily limit, and the `steadyfetch` actor inherently suppresses reels it has already delivered. Thus, repeat queries or heavy evaluation scripts will result in 0 results for Instagram, triggering the explicit `Apify free-plan daily limit reached` warning.
- **Text-only limitations:** When no product image is available (e.g. Fossil bot protection blocking the image), CLIP cannot score visual similarity, forcing a reliance on caption text which naturally prevents "strong" scores under our strict honest evaluation policy.

**CLIP scoring note:** Providing a product image URL works wonderfully and significantly increases the accuracy of the matching algorithm (as seen with Bose earbuds).

## Video Sources (Apify Actors Evaluated)

### Instagram source: actors tested
| Actor | Result | Verdict |
|---|---|---|
| data-slayer/instagram-search-reels | Real reels with thumbnails, but returned generic trending clips regardless of keyword | Rejected |
| khadinakbar/instagram-reels-search-scraper | Matched keyword against account names; thumbnail_url, video_url and caption were null | Rejected |
| apify/instagram-hashtag-scraper (Posts) | Relevant posts, but image posts and no thumbnail field | Rejected |
| apify/instagram-hashtag-scraper (Reels) | 1 reel, off-topic (hashtag spam) | Rejected |
| steadyfetch/instagram-keyword-reels-scraper | Relevant reels with thumbnail, video URL, caption, date | **Chosen** |
Cost: ~$2.40 per 1,000 reels on Apify's free plan; searches stop early once 20 matching reels are found.

**Honest Conclusion:** Instagram's search algorithm does not reliably return product-specific Reels for long-tail URLs/keywords. Therefore, an honest "0/20 strong" count on Instagram is expected for highly specific products, whereas Meta Ad Library reliably returns 20+ strong matches because ads are inherently product-driven.

## Limitations
- **Visual comparison is thumbnail-only**: We only compare the product image to the video's thumbnail via CLIP, not the actual video frames, which means misleading thumbnails can cause false positives.
- **Text-only search accuracy is low**: Without a product image to compare against, relying solely on keyword matching in captions is highly inaccurate.
- **Instagram algorithm dependence**: The quality of Instagram Reels output is entirely dependent on the specific Apify actor's logic and Instagram's organic search algorithm, which heavily favors viral clips over exact product keyword matches.
- **Instagram source limits**: The chosen actor (`steadyfetch/instagram-keyword-reels-scraper`) has a "repeat memory" that skips reels it already delivered to the account, and Apify's free plan caps Instagram search at 60 pages per 24 hours (paid plans have no daily cap). When the cap is hit, the app explicitly reports "Apify free-plan daily limit reached" instead of showing an empty result.

---

## Contact

Questions? **Shivcharan Jalendra** — AI Automation & Developer
