# Stage 9 — Integration Testing + Deploy

~2 days. Test all flows end-to-end and deploy.

## In Scope

- End-to-end testing: OAuth → save via web → save via extension → ask question → get answer
- Test with 10+ real URLs across different site types
- Edge case testing: very long pages, empty pages, failed scrapes, expired sessions
- Performance check: API response times, frontend load time
- Security review: CORS config, input sanitization, rate limits
- Backend deployment (Railway / Render / Fly.io)
- Frontend deployment (Vercel / Netlify)
- Update `.env` and OAuth callback URLs for production
- Update extension manifest with production API URL
- Update `README.md` with setup instructions + architecture

## Out of Scope

- Chrome Web Store submission (do this later after dogfooding)
- CI/CD pipeline (nice to have, not launch blocker)
- Load testing (overkill for 50-100 users)

## Key Decisions

- **Deploy backend + frontend separately** — backend on Railway/Render (supports Docker), frontend on Vercel/Netlify (static hosting). Both have free tiers.
- **Extension stays unpacked** — for personal use initially. Chrome Web Store submission can come later.
- **Production CORS** — update `FRONTEND_URL` to the deployed frontend domain.
- **No automated tests in CI** — manual verification is fine for launch. Add CI later.

## Checklist

- [ ] OAuth login works (Google + GitHub) in production
- [ ] Save a URL via web app → memory created → shows in dashboard
- [ ] Save a page via extension → memory created → shows in dashboard
- [ ] Ask a cross-source question → relevant answer with sources
- [ ] Delete a memory → cleaned up everywhere (MongoDB + Pinecone)
- [ ] Search and filters work
- [ ] Collections work
- [ ] Extension handles: no auth, network failure, duplicate URL
- [ ] SSE streaming works in production (no proxy issues)
- [ ] Rate limiting works (not too aggressive)
- [ ] README has setup instructions

## Done When

- App is live on a public URL
- All flows in checklist pass on production
- Extension works against production API
- README is updated
