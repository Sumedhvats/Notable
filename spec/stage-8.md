# Stage 8 — Frontend: Chat Q&A + Memory Detail + Knowledge Graph + Collections + Polish

~4 days. Build the remaining frontend pages, add knowledge graph visualization, export buttons, and polish the app.

## In Scope

- Chat / Q&A page with SSE streaming
- Memory detail page (full info, tags, entities, metadata, related memories)
- **Knowledge graph visualization** — D3.js force-directed graph of entities + co-occurrence edges
  - Per-memory graph on memory detail page
  - Global graph page (`/graph`) showing all entities across all memories
  - Interactive: pan, zoom, click node → filter memories by entity
- Search bar with real-time search + tag/date/entity filters
- Collections page (list, create, rename, delete, view memories in collection)
- **Export buttons** — "Download as Markdown" on memory detail + collection pages
- Delete + rescrape buttons on memory detail
- Edit tags manually
- Dark mode
- Mobile responsive (sidebar collapses, cards stack)
- Micro-animations (card hover, transitions, loading skeletons)

## Out of Scope

- Public shared collections (future.md)
- Drag-and-drop (future.md)

## Key Decisions

- **SSE streaming in chat** — use `fetch` with `ReadableStream` (not `EventSource`, since we need POST). Parse `data:` lines, render tokens as they arrive. Accumulate into full answer on `done` event.
- **Conversation history is client-side only** — stored in React state for the session. No backend persistence of chat history.
- **D3.js force-directed graph** — uses `d3-force` for layout. Nodes = entities (colored by type: person, place, concept, technology). Edges = co-occurrence (thickness = weight). Click a node → show all memories containing that entity.
- **Graph data fetched from API** — `GET /memories/:id/graph` for per-memory, `GET /graph` for global. Returns `{ nodes: [...], edges: [...] }`.
- **Dark mode via CSS variables** — toggle a `data-theme="dark"` attribute on `<html>`, swap CSS custom properties. Persist preference in `localStorage`.
- **Loading skeletons** — shimmer placeholders while fetching. No blank screens.
- **Export triggers browser download** — calls backend export endpoint, receives .md file, triggers download via `Blob` + `URL.createObjectURL`.

## Files

| File | What |
|---|---|
| `[NEW] src/pages/ChatPage.tsx` | Message input, streaming answer display, source citations |
| `[NEW] src/pages/MemoryDetailPage.tsx` | Full memory info, entities, related memories, graph, export, delete/rescrape/edit tags |
| `[NEW] src/pages/GraphPage.tsx` | Global knowledge graph (all entities across all memories) |
| `[NEW] src/pages/CollectionsPage.tsx` | Collection list + CRUD |
| `[NEW] src/pages/CollectionDetailPage.tsx` | Memories in a collection + export button |
| `[NEW] src/components/KnowledgeGraph.tsx` | D3.js force-directed graph component (reused on detail + global pages) |
| `[NEW] src/components/SearchBar.tsx` | Real-time search + filters (type, tags, entities, date) |
| `[NEW] src/components/StreamingAnswer.tsx` | Renders SSE tokens as they arrive |
| `[NEW] src/components/ExportButton.tsx` | "Download as Markdown" button |
| `[MODIFY] src/components/AppLayout.tsx` | Dark mode toggle, responsive sidebar, add `/graph` nav link |
| `[MODIFY] src/index.css` | Dark mode variables, animations, responsive breakpoints |

## Deps to Install (frontend)

```
d3 @types/d3
```

## Done When

- Chat page: type question → see answer stream in real-time → source citations linked
- Memory detail: full metadata, tags (editable), entities listed, related memories
- Knowledge graph on memory detail shows entities + connections for that memory
- Global `/graph` page shows all entities across all memories with pan/zoom
- Click a graph node → see all memories containing that entity
- Export button downloads .md file with frontmatter (works on memory detail + collection pages)
- Delete memory → removed from dashboard + Pinecone + MongoDB
- Rescrape → re-processes memory, status updates shown
- Search bar: type → results filter in real-time
- Filter by tag, entity, type, date range
- Collections: create, rename, delete, view contents
- Dark mode toggle works, preference persisted
- App looks good on mobile (sidebar collapses, cards stack)
- Loading skeletons shown during fetches
