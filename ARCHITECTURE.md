# Notable — Architecture

AI-powered bookmarks/memories system with Retrieval-Augmented Generation (RAG). Save URLs, ask natural-language questions across your saved content.

---

## System Overview

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Chrome       │     │                  │     │ MongoDB      │
│ Extension    │────▶│  Express API     │────▶│ (users)      │
│ (MV3)        │     │  (port 5000)     │     └──────────────┘
└──────────────┘     │                  │     ┌──────────────┐
                     │  - Auth (JWT)    │     │ Pinecone     │
┌──────────────┐     │  - Scraper       │────▶│ (vectors)    │
│ React        │────▶│  - Chunker*      │     └──────────────┘
│ Frontend     │     │  - Embeddings*   │     ┌──────────────┐
│ (Vite)       │     │  - Q&A*          │     │ Groq         │
└──────────────┘     │  - Enrichment*   │────▶│ (LLM)        │
                     │  - Collections*  │     └──────────────┘
┌──────────────┐     └───────┬──────────┘     ┌──────────────┐
│ Google/GitHub│             │                 │ Voyage AI    │
│ OAuth        │◀────────────┘                 │ (embeddings) │
└──────────────┘                               └──────────────┘

                         External APIs (scraper):
        Wikipedia    HN    StackExchange    GitHub    arXiv
        Crossref     Reddit   YouTube   Jina Reader
```

*Not yet implemented — planned for Days 6–14.*

---

## Tech Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| Runtime | Node.js + TypeScript (ESM) | ✅ |
| Framework | Express.js 4.21 | ✅ |
| Auth | Passport.js (Google + GitHub OAuth 2.0) + JWT | ✅ |
| Database | MongoDB 7 + Mongoose 8 | ✅ |
| Scraping | axios, cheerio, @mozilla/readability, jsdom | ✅ |
| YouTube Transcripts | `youtube-transcript` | ✅ |
| Vector Store | Pinecone (serverless) | 🔲 API keys needed |
| Embeddings | Voyage AI (`voyage-3-lite`) | 🔲 API keys needed |
| LLM Q&A | Groq (`llama-3.3-70b-versatile`) | 🔲 API keys needed |
| Validation | Zod | ✅ (imported, unused) |
| Chrome Extension | Manifest V3 | 🔲 Not started |
| Frontend | React + Vite + TypeScript + Tailwind | 🔲 Not started (v1 in git) |
| Containerization | Docker + Docker Compose | ✅ |

---

## Directory Structure

```
Notable/
├── ARCHITECTURE.md                  # This file
├── implementation_plan.md           # 30-day build plan
├── docker-compose.yml               # backend + MongoDB
├── backend/
│   ├── src/
│   │   ├── index.ts                 # Express entrypoint, middleware stack
│   │   ├── config/
│   │   │   └── passport.ts          # Google + GitHub OAuth strategies
│   │   ├── controllers/
│   │   │   └── auth.controller.ts   # OAuth callback, /me endpoint
│   │   ├── middleware/
│   │   │   └── auth.middleware.ts    # JWT Bearer verification
│   │   ├── models/
│   │   │   └── user.model.ts        # User schema (provider, email, name, avatar)
│   │   ├── routes/
│   │   │   └── auth.routes.ts       # /api/v1/auth/* routes
│   │   ├── services/
│   │   │   └── scraper.service.ts   # 1458-line scraping engine
│   │   ├── tests/
│   │   │   ├── scraper.test.ts      # Integration tests (16 real URLs)
│   │   │   ├── scraper-fallback.test.ts  # Mocked fallback chain tests
│   │   │   └── jina-debug.ts        # Jina Reader debug script
│   │   └── utils/
│   │       └── logger.ts            # Timestamped console logger
│   ├── package.json
│   ├── tsconfig.json
│   └── .env
├── extension/                       # 🔲 Not started (Week 3)
└── frontend/                        # 🔲 Not started (Week 4, v1 in git)
```

---

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/health` | None | Health check |
| `GET` | `/api/v1/auth/google` | None | Initiate Google OAuth |
| `GET` | `/api/v1/auth/google/callback` | Passport | Google OAuth callback → JWT redirect |
| `GET` | `/api/v1/auth/google/failure` | None | Google auth failure |
| `GET` | `/api/v1/auth/github` | None | Initiate GitHub OAuth |
| `GET` | `/api/v1/auth/github/callback` | Passport | GitHub OAuth callback → JWT redirect |
| `GET` | `/api/v1/auth/github/failure` | None | GitHub auth failure |
| `GET` | `/api/v1/auth/me` | JWT Bearer | Current user profile |

### Planned endpoints (Days 8–14)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/v1/memories` | JWT | Save URL (scrape → chunk → embed → store) |
| `POST` | `/api/v1/memories/from-extension` | JWT | Save from extension (skip scrape) |
| `GET` | `/api/v1/memories` | JWT | List memories (paginated, filterable) |
| `GET` | `/api/v1/memories/:id` | JWT | Get memory detail |
| `DELETE` | `/api/v1/memories/:id` | JWT | Delete memory + cleanup Pinecone |
| `POST` | `/api/v1/memories/:id/rescrape` | JWT | Re-run scrape pipeline |
| `GET` | `/api/v1/memories/:id/related` | JWT | Similar memories (vector similarity) |
| `GET` | `/api/v1/memories/:id/graph` | JWT | Entity relationships for knowledge graph |
| `GET` | `/api/v1/memories/:id/export/markdown` | JWT | Export single memory as .md |
| `POST` | `/api/v1/memories/:id/export/webhook` | JWT | Push markdown to webhook URL |
| `POST` | `/api/v1/ask` | JWT | RAG Q&A (embed → query → LLM → answer) |
| `GET` | `/api/v1/search` | JWT | Full-text search with filters |
| `POST` | `/api/v1/collections` | JWT | Create collection |
| `GET` | `/api/v1/collections` | JWT | List collections |
| `GET` | `/api/v1/collections/:id` | JWT | Collection detail |
| `GET` | `/api/v1/collections/:slug` | None | Public shared collection (anonymous) |
| `DELETE` | `/api/v1/collections/:id` | JWT | Delete collection |
| `POST` | `/api/v1/collections/:id/memories` | JWT | Add memory to collection |
| `DELETE` | `/api/v1/collections/:id/memories/:memId` | JWT | Remove memory from collection |
| `GET` | `/api/v1/collections/:id/export/markdown` | JWT | Export collection as .md |

---

## Data Models

### User (`user.model.ts`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `provider` | `'google' \| 'github'` | Yes | Enum |
| `providerId` | `string` | Yes | OAuth provider's user ID |
| `email` | `string` | Yes | Lowercased, trimmed |
| `name` | `string` | Yes | Trimmed |
| `avatar` | `string` | No | URL |
| `createdAt` | `Date` | Auto | Mongoose timestamp |
| `updatedAt` | `Date` | Auto | Mongoose timestamp |

**Indexes:** `{ provider, providerId }` (unique compound), `{ email }`

### Memory (planned — Day 11)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `ObjectId` | ref: User |
| `url` | `string` | Original URL |
| `title` | `string` | From scraper |
| `description` | `string` | From scraper |
| `contentType` | `string` | article/video/reddit/etc |
| `source` | `string` | scraper source used |
| `metadata` | `object` | ogImage, author, siteName, favicon |
| `tags` | `string[]` | Auto-tagged (Day 13) |
| `entities` | `string[]` | Extracted entities (Day 13) |
| `summary` | `string` | Auto-summary (Day 13) |
| `chunkCount` | `number` | Number of vectors in Pinecone |
| `status` | `'pending' \| 'processing' \| 'ready' \| 'failed'` | Pipeline state |
| `errorMessage` | `string` | If failed |

### Collection (planned — Day 14)

| Field | Type | Notes |
|-------|------|-------|
| `userId` | `ObjectId` | Owner |
| `name` | `string` | Display name |
| `description` | `string` | Optional |
| `memoryIds` | `ObjectId[]` | References to Memory |
| `isPublic` | `boolean` | Public sharing flag |
| `publicSlug` | `string` | Unique slug for shared URL |

---

## Scraper Architecture (Day 4–5 — Complete)

The scraper is the most complex component at 1,458 lines with a **multi-strategy fallback pipeline** and **13 site-specific adapters**.

### Extraction flow for `scrape(url)`

```
                        scrape(url)
                            │
                    detectContentType(url)
                    ┌───────┴────┬─────┬──────┐
                    │            │     │      │
               wikipedia    hackernews  github  ...
               mediawiki    firebase    rest
                    │            │     │      │
                    └───────┬────┴─────┴──────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
         contentType='article'      contentType='video'
         contentType='generic'       → extractYouTube()
              │                           │
       ┌──────┴──────┐            transcript or metadata
       │              │
   twitter?       reddit?
   → UNSUPPORTED  → extractReddit()
   (use extension)    │
                 API → .json → Jina → extension
       │              │
   linkedin?      else: extractGeneric()
   → UNSUPPORTED       │
                  ┌────┴──────────────────────┐
                  │                           │
            Step 1: fetchHtml() → Readability
                  │                           │
            Step 2: fetchHtml() → Cheerio (fallback)
                  │                           │
            Step 3: Jina Reader API (r.jina.ai)
                  │                           │
            All fail → EMPTY_CONTENT (suggest extension)
```

### Site-specific adapters

| Site | Adapter Function | API Used | Fallback |
|------|-----------------|----------|----------|
| Wikipedia | `extractMediaWiki()` | MediaWiki REST API | — |
| Hacker News | `extractHackerNews()` | Firebase API | — |
| Stack Exchange | `extractStackExchange()` | Stack Exchange API | — |
| GitHub | `extractGithub()` | GitHub REST API | — |
| arXiv | `extractArxiv()` | arXiv API | — |
| DOI/Crossref | `extractCrossref()` | Crossref API | — |
| Reddit | `extractReddit()` | Reddit OAuth API | → `.json` → Jina → extension |
| YouTube | `extractYouTube()` | `youtube-transcript` | → video metadata (OG) |
| Twitter/X | — | Throws `UNSUPPORTED_SITE` | Must use extension |
| LinkedIn | — | Throws `UNSUPPORTED_SITE` | Must use extension |
| Generic | `extractGeneric()` | Readability | → Cheerio → Jina → extension |

### Bot challenge detection

`isBotChallengePage(html)` detects 34 known patterns for Cloudflare, Akamai, Datadome, PerimeterX, and generic WAF blocks. Heuristic: short page (<200 chars) + 2+ match patterns → bot challenge.

### Error handling

`ScraperError` class with:
- `code`: UNSUPPORTED_SITE | TIMEOUT | HTTP_ERROR | EMPTY_CONTENT | INVALID_URL | NON_HTML
- `statusCode`: HTTP status
- `suggestion`: Human-readable guidance (e.g., "Use the Chrome extension")

---

## Auth Flow

```
User → GET /api/v1/auth/google
     → Redirect to Google consent screen
     → User approves
     → Google redirects to /api/v1/auth/google/callback
     → Passport authenticates, find-or-creates User in MongoDB
     → Controller signs JWT { userId } (7-day expiry)
     → Redirect to FRONTEND_URL/auth/callback?token=<JWT>
     → Frontend stores JWT

Subsequent requests:
     → Authorization: Bearer <JWT>
     → requireAuth middleware verifies JWT
     → req.userId available in controllers
```

---

## Planned RAG Pipeline (Days 8–12)

```
1. User POSTs URL to /memories
2. scrape(url) → ScrapedContent
3. chunker.service: split content → chunks (~500 tokens, ~50 overlap)
4. embedding.service: Voyage AI → 512-dim vectors per chunk
5. vector-store.service: upsert to Pinecone (namespace = userId)
     Vector ID: {memoryId}_{chunkIndex}
     Metadata: { memoryId, chunkIndex, chunkText }
6. Memory doc created in MongoDB (status: 'ready')

Q&A Flow:
1. User POSTs { question } to /ask
2. embedding.service: embed question → 512-dim vector
3. vector-store.service: query(userId, questionVector, topK=5)
4. qa.service: build prompt with question + top 5 chunks
5. Groq LLM (llama-3.3-70b): generate answer with source citations
```

---

## Implemented Features

### Completed (Days 1–5)
- [x] Express server with CORS, sessions, error handling
- [x] MongoDB connection (graceful — starts even without DB)
- [x] Google OAuth 2.0 (Passport strategy, find-or-create user)
- [x] GitHub OAuth 2.0 (Passport strategy, find-or-create user)
- [x] JWT signing (7-day expiry), verification middleware
- [x] `GET /health`, `GET /auth/me` endpoints
- [x] Full scraper with 13 site-specific adapters
- [x] Fallback chain: Readability → Cheerio → Jina → extension suggestion
- [x] Bot challenge detection (34 patterns)
- [x] Metadata extraction (OG tags, JSON-LD, favicon)
- [x] YouTube transcript extraction
- [x] Reddit extraction (OAuth API → .json → Jina)
- [x] Academic content (arXiv, DOI/Crossref)
- [x] Developer content (GitHub, Stack Exchange)
- [x] Docker Compose (Express + MongoDB)
- [x] Integration tests (16 real URLs) + unit tests (6 fallback scenarios)

### Planned (Days 6–30)
- [ ] Chunker service (paragraph splitting, 500-token chunks, 50-token overlap)
- [ ] Embedding service (Voyage AI, batching, rate limits)
- [ ] Vector store (Pinecone upsert/query/delete)
- [ ] Memory CRUD + create pipeline (scrape → chunk → embed → store → enrich)
- [ ] RAG Q&A (embed → query → Groq → answer)
- [ ] Enrichment (auto-tag, auto-summary, entity extraction)
- [ ] Full-text search + filters
- [ ] Collections + public sharing + markdown export
- [ ] Knowledge graph (entity extraction + co-occurrence edges)
- [ ] Chrome Extension (MV3)
- [ ] React frontend (dashboard, chat, collections, PWA)
- [ ] Deploy (Railway/Render + Vercel/Netlify)

---

## Features Added to Plan

### Knowledge graph (Day 13 — enrichment)
- Entity extraction via Groq (people, places, concepts)
- `GET /memories/:id/graph` returns entities + co-occurrence relationships
- Force-directed D3.js/vis-network visualization (Day 27)
- Global entity graph page: `/graph`
- Entity-based search filter

### Public shared collections (Day 14 — collections)
- `isPublic` + `publicSlug` fields on Collection model
- Anonymous read-only `GET /collections/:slug` endpoint
- Rate-limited (30 req/min/IP)
- No auth required for shared views

### Obsidian/Notion/Logseq export (Day 14 — collections)
- `GET /collections/:id/export/markdown` — full collection as .md
- `GET /memories/:id/export/markdown` — single memory as .md
- `POST /memories/:id/export/webhook` — push markdown to configurable URL (Notion API / Obsidian Webhook plugin)

### Offline/PWA support (Day 28 — frontend polish)
- `manifest.json` + service worker for installable PWA
- IndexedDB cache layer for recent memories
- Offline indicator badge
- Background sync queue — queue saves made offline, replay when online

---

## Limitations

### Current (Days 1–5)
| Limitation | Impact | Workaround |
|------------|--------|------------|
| MongoDB fallback warns but starts | Auth endpoints fail without DB | Ensure MongoDB is running |
| Sessions use memory store | Lost on restart | Acceptable (10-min TTL, OAuth only) |
| No rate limiting | No abuse protection | Add `express-rate-limit` |
| No input validation (Zod imported but unused) | No request body validation | Add Zod schemas per endpoint |
| Scraper Jina fallback depends on external service | Jina rate limits may block | Reduce reliance on Jina fallback |
| No CORS for extension origin | Extension can't call API | Add extension origin to CORS at deploy |

### Architecture-wide
| Limitation | Impact | Mitigation |
|------------|--------|------------|
| No background job queue | Sync pipeline blocks request | Acceptable for single-user; add BullMQ for scale |
| No Redis session store | Sessions lost on restart | Acceptable (10-min TTL) |
| Pinecone on free tier | 2GB storage, 100 upserts/s limit | Monitor usage; upgrade if needed |
| Voyage AI free tier | 200M tokens total | Monitor consumption |
| Groq free tier | 6000 tokens/min, 30 req/min | Acceptable for single user |
| LLM API costs scale with usage | PAYG beyond free tier | Set usage alerts |
| Scraper can't handle JS SPAs | Auth-required sites fail | Must use Chrome extension |
| No webhook retry mechanism | Webhook push failures lost | Add retry queue with exponential backoff |
| No snippet extraction for highlights | Can't anchor highlights to dom | Requires DOM position storage |
| No offline vector search | PWA offline = read-only cached data | IndexedDB cache layer (Day 28) |
| No cross-user collaboration | All data is per-user private | Future: shared workspaces |

### Site-specific scraper limitations
| Site | Limitation |
|------|------------|
| Twitter/X | Blocked server-side; requires extension |
| LinkedIn | Blocked server-side; requires extension |
| Reddit | Cloudflare may block; .json fallback rate-limited |
| YouTube | Transcript only (no comments/description without Data API key) |
| Cloudflare sites | Requires Jina fallback (unreliable) |
| Paywalled sites | Scraper only gets preview/teaser content |
| PDFs | Detected as NON_HTML; no PDF text extraction |

---

## Configuration Reference

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `5000` | No | Server port |
| `MONGODB_URL` | — | For auth | MongoDB connection string |
| `JWT_SECRET` | — | Yes | JWT signing key |
| `SESSION_SECRET` | `dev-secret-change-me` | No | Express session secret |
| `FRONTEND_URL` | `http://localhost:5173` | No | CORS origin + OAuth redirect |
| `NODE_ENV` | — | No | Enables secure cookies + hides stack traces |
| `GOOGLE_CLIENT_ID` | — | For Google auth | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | For Google auth | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | — | For Google auth | OAuth callback URL |
| `GITHUB_CLIENT_ID` | — | For GitHub auth | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | — | For GitHub auth | GitHub OAuth client secret |
| `GITHUB_CALLBACK_URL` | — | For GitHub auth | OAuth callback URL |
| `GROQ_API_KEY` | — | For RAG | Groq LLM API key |
| `VOYAGE_API_KEY` | — | For embeddings | Voyage AI API key |
| `PINECONE_API_KEY` | — | For vector store | Pinecone API key |
| `PINECONE_INDEX_NAME` | `notable` | No | Pinecone index name |
| `YOUTUBE_API_KEY` | — | For full metadata | YouTube Data API key |
| `REDDIT_CLIENT_ID` | — | For Reddit API | Reddit OAuth client ID |
| `REDDIT_CLIENT_SECRET` | — | For Reddit API | Reddit OAuth client secret |
| `REDDIT_USER_AGENT` | — | For Reddit API | Reddit API user agent |
| `GITHUB_API_TOKEN` | — | Extended GitHub API | GitHub personal access token |
| `JINA_API_KEY` | — | For Jina Reader | Jina Reader API key |

---

## Deployment Architecture

```
Production:

[Cloudflare DNS] → [Railway/Render: Express API :5000]
                    [MongoDB Atlas: M0 free tier]
                    [Pinecone: serverless free tier]

Frontend: [Netlify/Vercel: React SPA] → API requests
Extension: [Chrome Web Store] → API requests

Docker (dev):

docker-compose up
→ Express API on :5000 (hot-reload via volume mount)
→ MongoDB 7 on :27017 (persistent volume)
```
