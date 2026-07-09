# Stage 6 — Extension: API + Auth + Bookmark Listener + Popup

~3 days. Wire the extension to the backend — auth, saving memories, bookmark capture, and a functional popup UI.

## In Scope

- Auth flow: open OAuth page from extension → capture session/token → store in `chrome.storage.local`
- Manual save: user clicks extension icon → popup → confirm → extract → POST to backend
- Bookmark listener: `chrome.bookmarks.onCreated` → extract → POST to backend
- Popup UI: current page title, save button, optional tag input, status indicator, "already saved" detection
- Error handling: network failures, auth errors, API errors
- Badge icon changes on save success/failure

## Out of Scope

- Frontend web app (Stages 7-8)
- Complex popup features (these are simple)

## Key Decisions

- **Bookmark capture is opt-in** — user enables it in extension settings (options page). Off by default to avoid capturing private/banking pages.
- **Auth via better-auth session** — extension opens the backend OAuth URL in a new tab, better-auth handles the flow, extension captures the session token from the redirect.
- **Token stored in `chrome.storage.local`** — persists across browser restarts.
- **Extension hits `POST /memories/extension`** — sends pre-extracted content, skips server-side scraping.
- **Retry on failure** — if API call fails, queue locally in `chrome.storage.local` and retry next time extension activates. MV3 service workers can be killed at any time.

## Files

| File | What |
|---|---|
| `[MODIFY] extension/background.ts` | Bookmark listener, API calls, retry queue |
| `[MODIFY] extension/popup.ts` | Save button, tag input, status display, "already saved" check |
| `[MODIFY] extension/popup.html` | Styled popup with form elements |
| `[MODIFY] extension/options.ts` | API URL config, login button, bookmark capture toggle |
| `[MODIFY] extension/options.html` | Settings form |
| `[MODIFY] extension/manifest.json` | Add host permissions for production API URL if needed |

## Done When

- User can log in from extension options → token stored
- Clicking extension icon → popup shows page title → save → memory created in backend
- Adding optional tags in popup works
- Bookmark listener (when enabled) auto-captures page content → memory created
- "Already saved" shown for duplicate URLs
- Badge icon updates on success (✓) / failure (✗)
- Network failure → queued locally → retried on next activation
- Unauthorized → prompts re-login
