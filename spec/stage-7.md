# Stage 7 — Frontend: React Setup + Auth + Dashboard + Save URL

~3 days. Set up the React app, implement auth, build the memory dashboard, and add the save-URL form.

## In Scope

- React + Vite + TypeScript project setup
- Routing: `/login`, `/dashboard`, `/memory/:id`, `/chat`, `/collections`
- Auth flow: Google/GitHub login buttons → OAuth redirect → capture session → protected routes
- API client (Axios/fetch with auth interceptor)
- Dashboard page: memory cards grid, content type filter tabs, sort by date, pagination
- Save URL modal: URL input, optional tags, submit → show processing status
- Duplicate URL detection ("already saved")
- App shell layout: sidebar nav, header with user avatar, main content area

## Out of Scope

- Chat Q&A UI (Stage 8)
- Memory detail page (Stage 8)
- Collections UI (Stage 8)
- Dark mode / responsive polish (Stage 8)

## Key Decisions

- **Vite + React 18 + TypeScript** — fast dev server, good DX.
- **Auth context** — stores better-auth session, wraps protected routes. Redirects to `/login` if not authenticated.
- **Memory cards** — show: title, description snippet, tags, site favicon, og:image preview, status badge (`pending`/`processing`/`ready`/`failed`), content type icon.
- **Status polling** — after saving a URL, poll `GET /memories/:id/status` every 2s until `ready` or `failed`. Show a progress indicator.
- **No state management library** — React context + `useState`/`useEffect` is enough for this scale. Add Zustand later if needed.

## Files

| File | What |
|---|---|
| `[NEW] frontend/` | Vite + React + TypeScript project |
| `[NEW] src/contexts/AuthContext.tsx` | Auth state, login/logout, protected route wrapper |
| `[NEW] src/api/client.ts` | Axios instance with auth header interceptor |
| `[NEW] src/pages/LoginPage.tsx` | Google + GitHub login buttons |
| `[NEW] src/pages/DashboardPage.tsx` | Memory card grid with filters |
| `[NEW] src/components/MemoryCard.tsx` | Individual memory card component |
| `[NEW] src/components/SaveUrlModal.tsx` | URL input + tags + status tracking |
| `[NEW] src/components/AppLayout.tsx` | Sidebar + header shell |
| `[NEW] src/index.css` | Design system: colors, typography, spacing |

## Done When

- `npm run dev` starts Vite dev server
- OAuth login works (Google + GitHub) → session persists
- Dashboard shows saved memories as cards with images/tags/status
- Filter tabs work (All, Articles, Tweets, Videos, Reddit)
- Pagination or infinite scroll loads more memories
- Save URL modal: enter URL → submit → status updates → card appears
- Duplicate URL detection works
- Unauthenticated users redirected to login
