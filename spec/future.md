# Future — Post-Launch Features

Features deferred from the main build. Tackle after the core app is live and stable.

---

## Public Shared Collections

- `isPublic` + `publicSlug` fields on Collection model
- Anonymous `GET /collections/:slug` endpoint (no auth)
- Rate-limited public endpoints
- Public collection view page in frontend

**Why deferred:** Privacy implications need careful thought. Rate limiting and abuse prevention required.

---

## Webhook Export

- `POST /memories/:id/export/webhook` — pushes markdown to a configurable URL
- Notion API integration
- Obsidian Webhook plugin integration

**Why deferred:** Depends on per-user webhook config UI. Core markdown export (download) is in Stage 4/8.

---

## Other Ideas

- Conversation history persistence (backend-stored chat history)
- Drag-and-drop memories into collections
- Browser extension for Firefox
- Import bookmarks from browser (bulk import)
- Shared collections with collaborators (multi-user)
- AI-suggested collections ("You save a lot about TypeScript — create a collection?")
- PWA / offline support (service worker, IndexedDB caching, background sync)
