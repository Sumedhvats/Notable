# Stage 4 — Enrichment + Entity Extraction + Collections + Search + Export

~4 days. Add auto-tagging, auto-summary, and entity extraction via Groq. Build collections CRUD, search/filter endpoints, and markdown export. Can be built in parallel with Stage 5 (extension).

## In Scope

- Enrichment service — auto-tagging + auto-summary via Groq LLM
- **Entity extraction** — extract people, places, concepts, technologies from content via Groq
- **Entity deduplication** — normalize extracted entities ("JavaScript" / "JS" / "javascript" → single canonical form)
- **Co-occurrence edges** — when two entities appear in the same memory, store that relationship
- **Graph endpoint** — `GET /memories/:id/graph` returns entities + co-occurrence edges for a memory
- **Global graph endpoint** — `GET /graph` returns all entities + edges across all user memories
- Hook enrichment into memory pipeline (runs after vectors are stored)
- Collection model + CRUD API
- Add/remove memories to/from collections
- Search endpoint — MongoDB text index on title/description/tags/entities
- Filters: `?type=&tags=&entities=&from=&to=&sort=`
- **Markdown export** — `GET /memories/:id/export/markdown` and `GET /collections/:id/export/markdown`

## Out of Scope

- Graph visualization in frontend (Stage 8 — D3.js)
- Public shared collections (future.md)
- Webhook export to Notion/Obsidian (future.md)

## Key Decisions

- **Enrichment is async** — runs after the main pipeline completes. If it fails, the memory still saves as `ready` — just without auto-tags/summary/entities. Not worth blocking on.
- **Enrichment uses a separate BullMQ queue** — `enrichmentQueue` with lower priority. Main pipeline completes → enqueues enrichment job.
- **Tags are combined** — user-provided tags (from save) + auto-generated tags (from enrichment) are merged.
- **Entity extraction in the same Groq call** — single prompt asks for tags + summary + entities to minimize API calls. Structured JSON output via system prompt.
- **Entity deduplication** — normalize to lowercase, merge known aliases (e.g., "JS" → "JavaScript"). Store canonical form + aliases array. Simple heuristic matching, not ML-based.
- **Entity model** — entities are stored as their own collection (not embedded in Memory). Each entity has `{ name, type, aliases[], memoryIds[] }`. Co-occurrence edges stored as `{ entityA, entityB, memoryIds[], weight }`.
- **Collections are simple** — a collection is just a name + description. Memories have a `collections: ObjectId[]` array. Many-to-many.
- **Search is MongoDB text search** — text index on `title`, `description`, `tags`, `entities`. Not semantic search (that's what Q&A is for).
- **Markdown export** — generates .md file with YAML frontmatter (title, url, tags, date) + content reconstructed from chunks in MongoDB.

## Files

| File | What |
|---|---|
| `[NEW] src/services/enrichment.service.ts` | `enrich(memoryId)` — sends first ~2000 chars to Groq for tags + summary + entities, updates memory, upserts entities |
| `[NEW] src/models/entity.model.ts` | `{ name, type, aliases[], userId, memoryIds[] }` |
| `[NEW] src/models/edge.model.ts` | `{ entityA, entityB, userId, memoryIds[], weight }` — co-occurrence edges |
| `[MODIFY] src/config/queue.ts` | Add `enrichmentQueue` |
| `[MODIFY] src/workers/memory.worker.ts` | After main pipeline → enqueue enrichment job |
| `[NEW] src/models/collection.model.ts` | `{ name, description, userId, createdAt }` |
| `[NEW] src/routes/collection.routes.ts` | CRUD + add/remove memories |
| `[NEW] src/controllers/collection.controller.ts` | Collection CRUD handlers |
| `[NEW] src/routes/graph.routes.ts` | `GET /memories/:id/graph`, `GET /graph` |
| `[NEW] src/controllers/graph.controller.ts` | Returns entities + edges for graph rendering |
| `[NEW] src/services/export.service.ts` | Generate markdown from memory/collection (reconstructs content from chunks) |
| `[MODIFY] src/routes/memory.routes.ts` | Add search + export endpoints |
| `[MODIFY] src/controllers/memory.controller.ts` | Add `search`, `exportMarkdown` handlers |
| `[MODIFY] src/models/memory.model.ts` | Add `entities: string[]` field, text index on `title`, `description`, `tags`, `entities` |

## Done When

- New memories auto-get tags + summary + entities after saving
- Entities are deduplicated (e.g., "JS" and "JavaScript" merged)
- Co-occurrence edges created when entities share a memory
- `GET /memories/:id/graph` returns entities + edges for a single memory
- `GET /graph` returns all entities + edges for the user
- Enrichment failure doesn't block the memory from being `ready`
- Collection CRUD works: create, list, update, delete
- Add/remove memories to collections works
- `GET /memories/search?q=javascript` returns matching memories
- Filters by type, tags, entities, date range, sort order all work
- `GET /memories/:id/export/markdown` returns a .md file with frontmatter
- `GET /collections/:id/export/markdown` returns a .md file with all memories
