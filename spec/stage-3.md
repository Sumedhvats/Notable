# Stage 3 — Memory CRUD + Q&A with Streaming

~3 days. Complete the memory API (list, get, delete, rescrape, related) and build the Q&A service with SSE streaming.

## In Scope

- Memory CRUD: list (paginated), get, delete (+ Pinecone + chunk cleanup), rescrape
- Related memories endpoint (Pinecone similarity)
- Q&A service — embed question → query Pinecone → prompt Groq → stream answer
- Two ask endpoints: non-streaming (JSON) + streaming (SSE)

## Out of Scope

- Enrichment / auto-tags (Stage 4)
- Collections (Stage 4)
- Search/filters (Stage 4)
- Frontend chat UI (Stage 8)

## Key Decisions

- **SSE for streaming** — simpler than WebSocket, one-directional (server→client), auto-reconnect, works through proxies. Frontend will use `EventSource` or `fetch` with readable stream.
- **Non-streaming fallback** — `POST /ask` returns full JSON `{ answer, sources[] }` for simple consumers (extension, curl). `POST /ask/stream` uses SSE.
- **Groq model configurable** — env var `GROQ_MODEL` (default: `llama-3.3-70b-versatile`).
- **Delete cascade** — deleting a memory also deletes its Pinecone vectors and MongoDB chunks.
- **Rescrape** — re-runs full pipeline: delete old vectors/chunks → scrape → chunk → embed → upsert.

## Files

| File | What |
|---|---|
| `[MODIFY] src/routes/memory.routes.ts` | Add `GET /memories`, `GET /memories/:id`, `DELETE /memories/:id`, `POST /memories/:id/rescrape`, `GET /memories/:id/related` |
| `[MODIFY] src/controllers/memory.controller.ts` | Add `list`, `get`, `delete`, `rescrape`, `getRelated` |
| `[NEW] src/services/qa.service.ts` | `ask(question, userId)` → embed → query → prompt → answer. Both streaming and non-streaming modes. |
| `[NEW] src/routes/ask.routes.ts` | `POST /ask` (JSON), `POST /ask/stream` (SSE) |
| `[NEW] src/controllers/ask.controller.ts` | `ask` (non-streaming), `askStream` (SSE) |

## SSE Format

```
data: {"type":"token","content":"The"}
data: {"type":"token","content":" article"}
data: {"type":"token","content":" discusses"}
...
data: {"type":"sources","sources":[{"title":"...","url":"...","score":0.92}]}
data: {"type":"done"}
```

## Env Vars to Add

```
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
```

## Done When

- `GET /memories` returns paginated list with `?page=&limit=`
- `DELETE /memories/:id` cleans up Pinecone + MongoDB chunks
- `POST /memories/:id/rescrape` re-processes a memory
- `GET /memories/:id/related` returns similar memories
- `POST /ask` returns `{ answer, sources[] }` with correct citations
- `POST /ask/stream` streams tokens via SSE, ends with sources
- Save 3+ URLs → ask a cross-source question → get relevant answer
