# Stage 5 — Extension: Scaffold + Content Extraction

~3 days. Build the Chrome extension shell and the content extraction engine. Test on real sites. No backend API calls yet (that's Stage 6).

Can be built in parallel with Stages 3 and 4.

## In Scope

- Extension directory structure + Manifest V3
- Build tooling (TypeScript → JS bundle)
- Content script with site-specific extraction logic
- Smart fallback extraction (article → largest text block → body)
- Metadata extraction (title, description, og:image, author, favicon)
- Content type detection from URL hostname
- Test extraction on Twitter, Reddit, YouTube, LinkedIn, Medium, generic blogs
- Basic popup HTML shell (no functionality yet)

## Out of Scope

- API calls to backend (Stage 6)
- Auth integration (Stage 6)
- Bookmark listener (Stage 6)
- Popup save/tag functionality (Stage 6)

## Key Decisions

- **Manifest V3** — required for new Chrome extensions. Service worker instead of persistent background page.
- **Content script injects on demand** — `chrome.scripting.executeScript` from background, not `content_scripts` in manifest. Only runs when triggered.
- **Site-specific selectors** — targeted DOM selectors for Twitter (`[data-testid="tweetText"]`), Reddit, YouTube, LinkedIn to grab only core content. Fallback to generic extraction.
- **Truncate to ~10,000 chars** — cap extracted content to avoid huge payloads.
- **Build with plain `tsc` or esbuild** — no heavy bundler. Extension code is simple enough.

## Files

| File | What |
|---|---|
| `[NEW] extension/manifest.json` | MV3: permissions (`activeTab`, `scripting`, `bookmarks`, `storage`), host permissions for backend |
| `[NEW] extension/background.ts` | Service worker skeleton (no logic yet, wired in Stage 6) |
| `[NEW] extension/content.ts` | Content script — injected into pages to extract content |
| `[NEW] extension/utils/extractor.ts` | Site-specific extraction: detect site → use selector → fallback chain |
| `[NEW] extension/popup.html` | Basic popup shell with placeholder UI |
| `[NEW] extension/popup.ts` | Empty for now |
| `[NEW] extension/options.html` | Settings page shell (API URL, login — wired in Stage 6) |
| `[NEW] extension/options.ts` | Empty for now |
| `[NEW] extension/icons/` | Extension icons |

## Extraction Rules

```
1. Detect site from URL hostname
2. Use site-specific selector for core content only
3. Strip engagement UI (likes, shares, reply boxes)
4. Extract metadata (title, og:image, author, favicon, etc.)
5. Truncate to ~10,000 chars
6. Fallback: <article> → largest text-dense block → body.innerText stripped
```

## Done When

- Extension loads in Chrome (developer mode, unpacked)
- Content script can be manually triggered (via dev tools / test page)
- Extraction produces clean text from: Twitter, Reddit, YouTube, LinkedIn, Medium, generic blog
- Metadata (title, og:image, etc.) extracted correctly
- Generic fallback works on arbitrary pages
