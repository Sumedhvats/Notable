# Stage 2 — Memory Model + Async Pipeline

~3 days. Create the Memory data model, set up BullMQ with Redis, and build the async creation pipeline that ties scraper → chunker → embedder → vector store together.

## In Scope

- Memory Mongoose model
- Zod validation schemas for memory endpoints
- BullMQ + Redis setup (queue config, worker skeleton)
- Memory creation endpoints: `POST /memories` (from URL) + `POST /memories/extension` (from extension)
- Worker process: scrape → chunk → embed → upsert → update status
- Docker Compose: add Redis volume + AOF persistence
- Graceful shutdown: drain worker before exit

## Out of Scope

- Memory list/get/delete (Stage 3)
- Q&A (Stage 3)
- Enrichment / auto-tags (Stage 4)
- Collections (Stage 4)

## Key Decisions

- **Async pipeline** — `POST /memories` returns `202 Accepted` immediately with `{ memoryId, status: 'pending' }`. The worker processes in the background.
- **Status tracking** — Memory status: `pending → processing → ready | failed`. Client polls `GET /memories/:id/status`.
- **BullMQ retry** — 3 attempts with exponential backoff (2s, 4s, 8s) on failure.
- **Idempotency** — duplicate URL check per user (compound unique index `{ url, userId }`). If duplicate, return existing memory.
- **Worker lives in same process** — starts alongside Express in `index.ts`. No separate worker process for now.

## Files

| File | What |
|---|---|
| `[NEW] src/models/memory.model.ts` | `{ url, title, description, contentType, source, status, tags, collections, chunkCount, userId, errorMessage, metadata }` |
| `[NEW] src/schemas/memory.schema.ts` | Zod schemas: `createMemorySchema`, `createFromExtensionSchema` |
| `[NEW] src/config/queue.ts` | Redis connection + BullMQ `memoryQueue` with default job options |
| `[NEW] src/workers/memory.worker.ts` | Worker: receive job → scrape (if URL mode) → chunk → embed → upsert → save chunks → update memory status |
| `[NEW] src/routes/memory.routes.ts` | `POST /memories`, `POST /memories/extension`, `GET /memories/:id/status` |
| `[NEW] src/controllers/memory.controller.ts` | `createFromUrl`, `createFromExtension`, `getStatus` |
| `[MODIFY] docker-compose.yml` | Add `redis-data` volume, AOF config, `maxmemory-policy noeviction` |
| `[MODIFY] src/index.ts` | Start worker, add worker to graceful shutdown |

## Deps to Install

```
bullmq ioredis
```

## Env Vars to Add

```
REDIS_URL=redis://localhost:6379
```

## Done When

- `POST /memories` with a URL returns `202` → worker picks up job → status goes `pending → processing → ready`
- `POST /memories/extension` with pre-extracted content does the same (skips scraping)
- Duplicate URL returns existing memory
- Failed scrapes → `status: 'failed'` with `errorMessage`
- Worker retries on transient failure
- `GET /memories/:id/status` returns current status
- Redis container has persistent volume
- `SIGTERM` drains active jobs before exit
