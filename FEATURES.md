# Notable — Features

---

## 1. OAuth Authentication (Google + GitHub)

**What it does:** Users log in with their Google or GitHub account. No passwords, no signup forms.

**How it works:**
- Backend uses Passport.js with two strategies (`passport-google-oauth20`, `passport-github2`).
- User clicks "Sign in with Google/GitHub" → redirected to provider consent screen → callback hits backend → Passport find-or-creates a `User` document in MongoDB → backend signs a JWT (`{ userId }`, 7-day expiry) → redirects to frontend with `?token=<JWT>` in the URL.
- Subsequent API requests include `Authorization: Bearer <JWT>` header. The `requireAuth` middleware verifies the token and attaches `req.userId`.

**Limitations:**
- No email/password auth (intentional — OAuth only).
- Sessions use in-memory store (lost on restart), but only used transiently during OAuth handshake (10-min TTL). JWT is the real auth mechanism.
- No refresh tokens — JWT lasts 7 days; after expiry, user must re-login.
- No account linking — Google and GitHub accounts are separate users even if same email.

---

## 2. Smart URL Scraping

**What it does:** Paste any URL → backend intelligently extracts full article content. Works on blogs, Wikipedia, YouTube, GitHub, Reddit, Hacker News, arXiv, research papers (DOI/Crossref), Stack Exchange, and more.

**How it works:**
- `GET /health` just confirms server is alive. Actual scraping happens via the `scrape(url)` function in `src/services/scraper.service.ts` (1,458 lines).
- The scraper first detects **content type** from the URL hostname (`article`, `video`, `reddit`, `tweet`, `generic`).
- For **known domains**, it uses the site's own API instead of scraping HTML:
  - **Wikipedia** → MediaWiki REST API (clean JSON, no HTML parsing)
  - **Hacker News** → Firebase API (stories + top comments)
  - **Stack Exchange** → Stack Exchange API (question + accepted answer)
  - **GitHub** → GitHub REST API (README for repos, issue/PR body)
  - **arXiv** → arXiv API (abstract + metadata)
  - **DOI/Crossref** → Crossref API (paper metadata)
  - **Reddit** → Reddit OAuth API → `.json` fallback → Jina Reader → suggests extension
  - **YouTube** → `youtube-transcript` package (capped at ~5 min) + video metadata
- For **unknown/generic pages**, a fallback chain runs:
  1. `fetchHtml()` → **Readability** (Mozilla's article extractor — best quality)
  2. `fetchHtml()` → **Cheerio** (regex-based fallback, strips nav/footer/ads)
  3. **Jina Reader** API (`r.jina.ai/<url>` — last resort for JS SPAs)
  4. If all fail → throws `EMPTY_CONTENT` with suggestion to use Chrome extension
- **Bot challenge detection**: `isBotChallengePage()` checks for 34 known patterns (Cloudflare, Akamai, Datadome, PerimeterX). If detected, skips local extraction entirely and goes straight to Jina/extension.
- **Error types**: `UNSUPPORTED_SITE` (Twitter/LinkedIn), `TIMEOUT`, `HTTP_ERROR`, `EMPTY_CONTENT`, `INVALID_URL`, `NON_HTML` (PDFs, images).

**Limitations:**
- **Twitter/X** and **LinkedIn** are completely blocked server-side (JS-rendered, auth-required, aggressive anti-bot). Must use Chrome extension.
- **Reddit** is flaky — Cloudflare may block, `.json` fallback is rate-limited, OAuth API is the only reliable path.
- **YouTube** gets transcript only (no comments, no description without Data API key).
- **Paywalled sites** (Medium members-only, NYT, WSJ) — scraper only gets preview/teaser content.
- **JS-heavy SPAs** (Notion, modern dashboards) — Readability/Cheerio get empty content; Jina fallback is unreliable.
- **PDFs, images, binary files** — detected as `NON_HTML`, no text extraction.
- **Reddit Jina fallback** depends on external service availability.
- **Bot challenge detection is heuristic** — false positives/negatives possible.

---

## 3. RAG Q&A (Planned — Days 8–12)

**What it does:** Ask natural-language questions across all your saved bookmarks. "What did I save about Docker networking?" → AI reads all relevant chunks and answers with source citations.

**How it will work:**
1. **Save pipeline (async via BullMQ)**: `POST /memories { url }` → create Memory doc (`status: pending`) → enqueue BullMQ job → return `202 Accepted { memoryId }`. A background **Worker** picks up the job: scrape → **chunker** (paragraph split, ~500 token chunks, ~50 token overlap) → **embedding** (Voyage AI `voyage-3-lite` → 512-dim vectors) → **vector store** (Pinecone upsert, namespace = `userId`, vector ID = `{memoryId}_{chunkIndex}`, metadata stores chunk text) → update Memory to `ready`.
2. **Enrichment (async via separate BullMQ queue)**: After main pipeline completes, a lower-priority enrichment job is enqueued: auto-tag, auto-summary, entity extraction → update Memory fields.
3. **Frontend polls** `GET /memories/:id/status` until status flips to `ready` or `failed`.
4. **Query pipeline (synchronous)**: `POST /ask { question }` → embed question → Pinecone query (top K=5 most similar chunks) → build prompt with question + chunks → **Groq** (`llama-3.3-70b-versatile`) generates answer with source citations.
5. BullMQ provides automatic retries (3 attempts, exponential backoff) if any step fails (API timeout, rate limit, network error).

**Limitations:**
- **API keys required**: Voyage AI (free 200M tokens), Pinecone (free 2GB), Groq (6000 tok/min free).
- **Free tier limits**: Pinecone free tier caps at 100 upserts/sec and 2GB total. Large collections will hit this.
- **Embedding cost scales** with number of chunks. A 100-page book = thousands of chunks = millions of tokens.
- **Requires Redis** — BullMQ depends on Redis. Adds a third service to the stack (MongoDB + Redis + API).
- **No re-embedding on content change** — if a page is re-scraped, old vectors are orphaned unless explicitly deleted.
- **No cross-user RAG** — queries only search the authenticated user's namespace.
- **Frontend needs polling** — no real-time push yet (WebSocket planned for future).

---

## 4. Knowledge Graph (Planned — Day 13 + Day 27)

**What it does:** Automatically extracts entities (people, places, concepts, technologies) from saved pages and shows how they connect. Visualized as an interactive force-directed graph.

**How it will work:**
- During enrichment (Day 13), each memory is passed to Groq with a prompt: "Extract notable entities from this text." Entities are stored as `entities[]` on the Memory document.
- Co-occurrence edges are computed: if entity A and entity B appear in the same memory, an edge is stored (with weight = number of shared memories).
- `GET /memories/:id/graph` returns `{ nodes: [...], edges: [...] }` for that memory's entities.
- `GET /graph` (global) returns all entities across all user memories.
- Frontend renders with D3.js force-directed layout (pan, zoom, click node to filter).

**Limitations:**
- **Entity quality depends on LLM** — Groq may miss entities or hallucinate them. No NER model behind it.
- **Co-occurrence is a weak relationship signal** — "Docker" and "Kubernetes" appearing in the same article means they're related, but the nature of the relationship isn't captured.
- **No hierarchical relationships** — "Python" as a child of "Programming Languages" isn't modeled. Tags are flat.
- **Visualization scales poorly** — 1000+ entities will be unusable in a force-directed graph. Needs clustering or filtering.
- **Cost** — entity extraction is an extra Groq call per memory, doubling LLM usage.

---

## 5. Public Shared Collections (Planned — Day 14)

**What it does:** Share a collection of bookmarks with anyone via a public link. No login required to view.

**How it will work:**
- Collections have `isPublic: boolean` and `publicSlug: string` (unique, auto-generated UUID).
- `GET /collections/:slug` requires no auth — returns collection metadata + list of memories (title, description, tags).
- Rate-limited to 30 req/min/IP to prevent abuse.
- Frontend renders a clean read-only "shared collection" page.

**Limitations:**
- **No access control beyond public/private** — no per-user sharing, no view counts, no expiry.
- **Rate limiting is simple** — IP-based, not user-based. Shared collections behind a NAT will all hit the same limit.
- **No content sanitization** — scraped content may contain tracking pixels or embeds from the original page.
- **No caching** — every request hits the server and queries MongoDB. Consider CDN caching for high-traffic collections.
- **Public slug is guessable** — UUID is secure but not user-memorable. No custom slugs.

---

## 6. Markdown Export & Webhook (Planned — Day 14)

**What it does:** Export any memory or collection as Markdown (compatible with Obsidian, Logseq, Notion). Or push to a webhook URL for automation.

**How it will work:**
- `GET /memories/:id/export/markdown` — returns `.md` file with YAML frontmatter (title, url, tags, date, source) and content body.
- `GET /collections/:id/export/markdown` — returns a single `.md` file with all memories concatenated, separated by `---`.
- `POST /memories/:id/export/webhook` — sends the same markdown payload to a user-configured URL (for Notion API, Obsidian Webhook plugin, Make/Zapier).
- YAML frontmatter format:
  ```yaml
  ---
  title: "Article Title"
  url: https://...
  tags: [tag1, tag2]
  source: readability
  saved: 2026-07-08
  ---
  ```

**Limitations:**
- **No bidirectional sync** — exporting to Obsidian/Notion is one-way. Changes in those tools are NOT synced back to Notable.
- **No formatting preservation** — scraper strips all HTML formatting. Code blocks, tables, and lists from the original page are lost.
- **Webhook push is fire-and-forget** — no retry logic if the webhook URL is down.
- **No scheduled exports** — must trigger manually via API.

---

## 7. Chrome Extension (Planned — Days 15–21)

**What it does:** Save pages directly from the browser — especially for sites the server scraper can't handle (Twitter, LinkedIn, Reddit). Also auto-saves bookmarked pages.

**How it will work:**
- Manifest V3 with `activeTab`, `scripting`, `bookmarks`, `storage` permissions.
- **Content script** (`content.ts`) reads the rendered DOM — uses `<article>` tag, Readability-like heuristic, or `document.body.innerText`. Extracts metadata (title, description, OG image, author).
- **Popup** shows current page title, save button, tag input, status indicator. Detects if URL is already saved.
- **Bookmark listener** (`chrome.bookmarks.onCreated`) auto-extracts and saves any page the user bookmarks.
- **Auth** via OAuth flow in options page — stores JWT in `chrome.storage.local`.
- Sends extracted content to `POST /memories/from-extension` (skips server-side scrape).

**Limitations:**
- **Chrome-only** initially. Firefox (MV2) and Safari require separate builds.
- **Cannot extract logged-out content** — only works as the currently logged-in user on the page.
- **YouTube extension extraction** is limited to what's visible in the DOM (comments must be expanded, transcript must be opened).
- **No offline queue** — if the API is unreachable, the save is lost.
- **No cross-device auth sync** — JWT is stored per browser instance. Must log in on each device.

---

## 8. Offline / PWA (Planned — Day 28)

**What it does:** Install Notable as a desktop app via PWA. Read saved memories offline. Queue saves made offline and sync when back online.

**How it will work:**
- `manifest.json` with icons, theme color, display mode (`standalone`).
- **Service worker** caches recent API responses (memories list, memory details).
- **IndexedDB** stores the last N memories locally for full offline access.
- **Offline indicator** badge shows when network is unavailable.
- **Background sync queue** — if you save a URL while offline, the request is queued in IndexedDB and replayed when connectivity returns (via `sync` event or periodic check).
- Markdown export buttons work offline (content is in IndexedDB).

**Limitations:**
- **No offline search** — local search only works on cached memories. Full-text search across all content requires the server.
- **No offline Q&A** — RAG pipeline requires Pinecone and Groq APIs (network).
- **IndexedDB storage limits** — browsers cap at ~50–500MB depending on browser. Large collections may not fully cache.
- **Service worker lifecycle is complex** — updates require careful version management.
- **Safari PWA support** is limited (no push notifications, no background sync).
- **Background sync has limited browser support** — works on Chrome, partial on Firefox, not on Safari.

---

## Feature Status Summary

| Feature | Status | Depends On |
|---------|--------|------------|
| Google OAuth | ✅ Done | — |
| GitHub OAuth | ✅ Done | — |
| URL Scraping (13 adapters) | ✅ Done | — |
| Bot Challenge Detection | ✅ Done | — |
| Chunker Service | 🔲 Day 6 | — |
| Redis + BullMQ Setup | 🔲 Day 7 | Redis in Docker |
| Embedding (Voyage AI) | 🔲 Day 8 | Chunker |
| Vector Store (Pinecone) | 🔲 Days 9–10 | Embedding |
| Async Memory Pipeline (BullMQ) | 🔲 Day 11 | Vector Store + BullMQ |
| Memory CRUD + Status Polling | 🔲 Day 12 | Memory Pipeline |
| RAG Q&A | 🔲 Day 12 | Memory Pipeline |
| Enrichment (auto-tag, summary) | 🔲 Day 13 | Memory Pipeline |
| Entity Extraction (Knowledge Graph) | 🔲 Day 13 | Enrichment |
| Knowledge Graph Visualization | 🔲 Day 27 | Entity Extraction + Frontend |
| Collections | 🔲 Day 14 | Memory CRUD |
| Public Shared Collections | 🔲 Day 14 | Collections |
| Markdown Export / Webhook | 🔲 Day 14 | Collections |
| Chrome Extension | 🔲 Days 15–21 | — |
| React Frontend | 🔲 Days 22–28 | Entire Backend |
| PWA / Offline | 🔲 Day 28 | Frontend |
| Integration Testing + Deploy | 🔲 Days 29–30 | Everything |
