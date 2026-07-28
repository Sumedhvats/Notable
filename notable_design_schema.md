# Notable — Frontend Design Schema

> **Design Direction:** Luminous Dark — Structured Intelligence  
> **Primary References:** Monochrome waveforms (atmosphere + knowledge graph) + Structured card grid UI (layout architecture)  
> **Theme:** Dark-only. No light mode.

---

## 1. Design Philosophy

### Core Principle
**"Intelligence should feel calm, not chaotic."**

Notable is a daily-use knowledge tool. The interface must fade into the background so the *content* and *AI insights* take focus. Every visual decision serves one goal: reduce cognitive load while signaling that something intelligent is happening beneath the surface.

### Mood
- **Atmospheric depth** over flat darkness
- **Restrained luminosity** over neon accents
- **Structural clarity** over decorative flair
- **Organic intelligence** (waveforms, soft motion) over mechanical precision

### What This Is NOT
- Not cyberpunk. No neon grids, no holographic chrome on every surface.
- Not brutalist. No raw unstyled HTML, no aggressive contrast.
- Not glassmorphic. Glass effects are used sparingly (modals only), not as a default card treatment.

---

## 2. Color System

### Background Hierarchy

| Token | Hex | Usage |
|-------|-----|-------|
| `bg-void` | `#050508` | Deepest background. Used behind the knowledge graph visualization and full-screen empty states. |
| `bg-base` | `#0A0A0F` | Primary app background. Sidebar, main canvas, page root. |
| `bg-surface` | `#111118` | Cards, panels, popovers, dropdown menus. |
| `bg-elevated` | `#181820` | Hover states on cards, active list items, input focus backgrounds. |
| `bg-overlay` | `rgba(5, 5, 8, 0.85)` | Modal backdrops with `backdrop-blur(12px)`. |

### Text Hierarchy

| Token | Hex | Usage |
|-------|-----|-------|
| `text-primary` | `#F0F0F5` | Headings, primary labels, active nav items. |
| `text-secondary` | `#9CA3AF` | Body text, descriptions, metadata. |
| `text-tertiary` | `#6B7280` | Timestamps, placeholders, disabled states, file paths. |
| `text-inverse` | `#0A0A0F` | Text on accent buttons or light surfaces (rare). |

### Border & Divider System

| Token | Value | Usage |
|-------|-------|-------|
| `border-subtle` | `rgba(255, 255, 255, 0.06)` | Card outlines, panel separators. |
| `border-default` | `rgba(255, 255, 255, 0.10)` | Input borders, active card rings. |
| `border-focus` | `rgba(255, 255, 255, 0.25)` | Focus rings, drag-over states. |
| `divider` | `rgba(255, 255, 255, 0.04)` | Horizontal rules inside panels. |

### Accent Palette (Restrained)

The accent color represents **AI presence**. It must feel special — used only when the system is actively thinking, generating, or highlighting an AI-derived insight.

| Token | Value | Usage |
|-------|-------|-------|
| `accent-primary` | `#A78BFA` | Primary AI indicator. Streaming cursor, entity highlights, active graph nodes. |
| `accent-secondary` | `#67E8F9` | Secondary AI state. Citations, source chips, success confirmation. |
| `accent-gradient` | `linear-gradient(135deg, #A78BFA 0%, #67E8F9 100%)` | AI avatar glow, save confirmation burst, graph edge highlights. |
| `accent-glow` | `rgba(167, 139, 250, 0.15)` | Subtle ambient glow behind AI panels. |

### Semantic Colors (Muted)

| Token | Hex | Usage |
|-------|-----|-------|
| `semantic-success` | `#34D399` | Saved confirmation, successful sync. |
| `semantic-warning` | `#FBBF24` | Rate limit approaching, incomplete scrape. |
| `semantic-error` | `#F87171` | Failed save, connection error. |
| `semantic-info` | `#60A5FA` | Neutral info badges, link previews. |

All semantic colors are desaturated ~20% compared to typical defaults to maintain the calm dark atmosphere.

---

## 3. Typography

### Font Stack

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### Scale

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| `display` | 32px / 2rem | 600 | 1.1 | -0.02em | Page titles ("Knowledge Base", "Collections") |
| `heading-1` | 24px / 1.5rem | 600 | 1.2 | -0.01em | Section headers, collection names |
| `heading-2` | 18px / 1.125rem | 500 | 1.3 | 0 | Card titles, memory titles |
| `heading-3` | 14px / 0.875rem | 500 | 1.4 | 0.01em | Panel headers, sub-sections |
| `body` | 14px / 0.875rem | 400 | 1.6 | 0 | Descriptions, article previews |
| `body-sm` | 13px / 0.8125rem | 400 | 1.5 | 0 | Metadata, timestamps, tags |
| `caption` | 12px / 0.75rem | 400 | 1.4 | 0.01em | Badges, tooltips, footer text |
| `mono` | 13px / 0.8125rem | 400 | 1.5 | 0 | URLs, code snippets, entity IDs |

### Rules
- **No text lighter than `#F0F0F5`** — pure white is too harsh on dark backgrounds.
- **Maximum 3 weights per screen** — typically 400, 500, 600.
- **Mono font only for:** URLs, code blocks, entity IDs, graph node labels.

---

## 4. Spacing & Layout

### Base Unit
`4px` — all spacing is a multiple of 4.

### Layout Grid
- **Desktop:** 12-column grid, `24px` gutter, `32px` outer margin.
- **Tablet:** 8-column grid, `20px` gutter, `24px` outer margin.
- **Mobile:** 4-column grid, `16px` gutter, `16px` outer margin.

### Z-Index Hierarchy

| Layer | Z-Index | Elements |
|-------|---------|----------|
| Background | 0 | App canvas, graph visualization |
| Content | 10 | Cards, text, images |
| Floating | 20 | Sticky headers, floating action buttons |
| Overlay | 30 | Modal backdrops, command palette |
| Popover | 40 | Dropdowns, tooltips, toasts |
| Critical | 50 | Error banners, blocking modals |

### App Shell Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  App Shell (100vw × 100vh, bg-base)                             │
│  ┌──────────┬──────────────────────────────┬─────────────────┐  │
│  │          │                              │                 │  │
│  │ Sidebar  │      Main Content Area       │  Detail Panel   │  │
│  │  240px   │      (fluid, min 640px)      │  380px fixed    │  │
│  │  fixed   │                              │  collapsible    │  │
│  │          │                              │                 │  │
│  └──────────┴──────────────────────────────┴─────────────────┘  │
│                        Command Palette (overlay, centered)       │
└─────────────────────────────────────────────────────────────────┘
```

#### Sidebar (Left)
- **Width:** `240px` fixed on desktop, collapsible to `64px` icon-only.
- **Background:** `bg-base` with a `1px` right border (`border-subtle`).
- **Content:** Logo, global nav, mini knowledge graph preview, collections list, tags.
- **Behavior:** Sticky on scroll. Collapses on tablet, becomes a drawer on mobile.

#### Main Content Area (Center)
- **Background:** `bg-base`.
- **Max-width:** `1200px` centered when reading a single memory.
- **Padding:** `32px` top, `24px` sides, `48px` bottom.
- **Scroll:** Independent scroll container.

#### Detail Panel (Right)
- **Width:** `380px` fixed on desktop.
- **Background:** `bg-surface` with a `1px` left border (`border-subtle`).
- **Content:** Memory detail, AI Q&A chat, source chunks, entity list.
- **Behavior:** Collapsible. On tablet/mobile, becomes a bottom sheet or full-screen overlay.

---

## 5. Component Specifications

### 5.1 Cards (Memory Card)

The primary content unit. Inspired by image(3)'s structured grid.

```
┌─────────────────────────────────────────┐
│  ┌─────────────┐                        │
│  │  Thumbnail  │  Title (heading-2)     │
│  │   80×80px   │  ─────────────────     │
│  │   rounded   │  Excerpt (body, 2      │
│  │   8px       │  lines truncated)      │
│  └─────────────┘                        │
│  ─────────────────────────────────────  │
│  [Tag] [Tag]              · 2h ago      │
└─────────────────────────────────────────┘
```

**Specs:**
- Background: `bg-surface`
- Border: `1px solid border-subtle`
- Border-radius: `12px`
- Padding: `16px`
- Gap between cards: `16px`
- Hover: Background shifts to `bg-elevated`, border becomes `border-default`, `translateY(-2px)`, `box-shadow: 0 4px 12px rgba(0,0,0,0.3)`.
- Active/Selected: `1px solid border-focus` ring, subtle `accent-glow` shadow.

**Thumbnail:**
- Size: `80px × 80px` or `120px × 80px` for wide previews.
- Border-radius: `8px`
- Object-fit: cover.
- Fallback: Site favicon centered on `bg-elevated` with `border-subtle`.

**States:**
- **Default:** As above.
- **Hover:** Elevated background, slight lift, cursor pointer.
- **Selected:** Focus ring + ambient glow. Used when detail panel is open.
- **Loading:** Skeleton shimmer (`bg-surface` → `bg-elevated` animation).

### 5.2 Buttons

**Primary Button**
- Background: `text-primary` (inverted — light button on dark bg).
- Text: `bg-base` (dark text).
- Padding: `8px 16px`.
- Border-radius: `8px`.
- Font: `body-sm`, weight 500.
- Hover: Opacity 0.9, `translateY(-1px)`.
- Active: `translateY(0)`.

**Secondary Button**
- Background: `bg-surface`.
- Border: `1px solid border-default`.
- Text: `text-primary`.
- Hover: Background `bg-elevated`.

**Ghost Button**
- Background: transparent.
- Text: `text-secondary`.
- Hover: Background `rgba(255,255,255,0.04)`, text `text-primary`.

**Icon Button**
- Size: `32px × 32px`.
- Border-radius: `8px`.
- Icon size: `16px`.
- All states same as Ghost.

**AI Action Button (Special)**
- Background: `accent-gradient`.
- Text: `bg-base`.
- Box-shadow: `0 0 20px accent-glow`.
- Used for: "Ask AI", "Summarize", "Save to Knowledge Base".

### 5.3 Inputs

**Search Bar (Global)**
- Background: `bg-surface`.
- Border: `1px solid border-subtle`.
- Border-radius: `10px`.
- Height: `40px`.
- Padding: `0 16px 0 40px` (left padding for search icon).
- Placeholder color: `text-tertiary`.
- Focus: Border `border-focus`, background `bg-elevated`, subtle inner glow.
- Icon: Search icon at `16px`, color `text-tertiary`, positioned `12px` from left.

**Text Input / Textarea**
- Background: `bg-base`.
- Border: `1px solid border-subtle`.
- Border-radius: `8px`.
- Padding: `10px 12px`.
- Focus: Same as search bar.
- Disabled: Opacity 0.5, cursor not-allowed.

### 5.4 Tags / Chips

**Default Tag**
- Background: `rgba(255,255,255,0.04)`.
- Border: `1px solid border-subtle`.
- Border-radius: `6px`.
- Padding: `4px 10px`.
- Font: `caption`, weight 500.
- Text: `text-secondary`.
- Hover: Background `rgba(255,255,255,0.08)`.

**AI-Generated Tag**
- Background: `accent-glow`.
- Border: `1px solid rgba(167, 139, 250, 0.3)`.
- Text: `accent-primary`.
- A tiny sparkle/dot icon before the text.

### 5.5 Modals & Overlays

**Modal Container**
- Background: `bg-surface`.
- Border: `1px solid border-default`.
- Border-radius: `16px`.
- Box-shadow: `0 24px 48px rgba(0,0,0,0.5)`.
- Max-width: `480px` (standard), `640px` (wide).
- Padding: `24px`.

**Modal Backdrop**
- Background: `bg-overlay`.
- Backdrop-filter: `blur(12px)`.
- Animation: Fade in `150ms` ease-out.

**Command Palette (Quick Search)**
- Position: Centered, `top: 20vh`.
- Width: `640px` max.
- Background: `bg-surface` with heavy blur.
- Border-radius: `16px`.
- Shadow: `0 24px 64px rgba(0,0,0,0.6)`.
- Input: Full-width, borderless at top.
- Results: Scrollable list below, max-height `400px`.

### 5.6 Tooltips

- Background: `bg-elevated`.
- Border: `1px solid border-default`.
- Border-radius: `8px`.
- Padding: `6px 10px`.
- Font: `caption`.
- Shadow: `0 4px 12px rgba(0,0,0,0.3)`.
- Arrow: `4px` solid, same background/border.

---

## 6. Page Specifications

### 6.1 Dashboard / Knowledge Base Home

**Layout:** Sidebar + Main (full width, no detail panel until selection).

**Header Area:**
- Page title: "Knowledge Base" (`display`).
- Subtitle: "X memories, last saved 2h ago" (`body-sm`, `text-tertiary`).
- Actions: Search bar (centered, max-width `480px`), "New Collection" button (secondary), view toggle (grid/list).

**Content:**
- **Grid view:** 3-column card grid (desktop), 2-column (tablet), 1-column (mobile).
- **List view:** Stacked rows, thumbnail left, metadata right.
- **Empty state:** Full-screen `bg-void` with an organic waveform visualization (inspired by image 1) gently animating. Centered text: "Your knowledge base is waiting. Save your first memory." + AI Action Button.

**Filters:**
- Horizontal scrollable chip row below search bar.
- Chips: "All", "Unread", "Tagged", "Articles", "Videos", etc.
- Active chip: `bg-elevated` + `text-primary`.

### 6.2 Memory Detail + AI Q&A Panel

**Layout:** Sidebar + Main (memory content) + Detail Panel (AI chat).

**Main Area:**
- Breadcrumb: "Knowledge Base / Collection Name" (`caption`).
- Memory title: `heading-1`.
- Metadata row: Favicon + domain, author, published date, save date. (`body-sm`, `text-tertiary`).
- Divider.
- Content body: Rendered markdown/HTML. `body` size, `1.7` line height for readability.
- Source chunks: Collapsible section at bottom showing vector chunks with similarity scores.

**Detail Panel (AI Q&A):**
- Header: "Ask about this" (`heading-3`) + close button.
- Chat history: Scrollable message list.
  - **User messages:** Right-aligned, `bg-elevated`, rounded `12px`.
  - **AI messages:** Left-aligned, transparent bg, streaming text with `accent-primary` cursor blink.
- Input: Fixed at bottom of panel. Textarea that auto-expands to `4` lines.
- Send button: AI Action Button (gradient), `32px` circle with arrow icon.
- Citations: Inline chips in AI response. Hover shows source chunk preview.

**Streaming States:**
- **Thinking:** Pulsing waveform dots (3 dots, staggered fade).
- **Generating:** Text appears character-by-character with `fade-in-up` micro-animation.
- **Done:** Cursor stops blinking, fades out. Citations become clickable.

### 6.3 Knowledge Graph Visualization

**Layout:** Full-screen canvas (sidebar collapsed or icon-only).

**Canvas:**
- Background: `bg-void`.
- Nodes: Soft organic blobs (inspired by image 1). Colored by entity type:
  - Person: `#A78BFA` (accent-primary)
  - Organization: `#67E8F9` (accent-secondary)
  - Topic: `#F0F0F5` (text-primary)
  - Location: `#34D399` (semantic-success)
- Node size: Based on occurrence frequency (min `8px`, max `32px`).
- Edges: `1px` lines, `rgba(255,255,255,0.08)`, opacity increases on hover.
- Labels: `caption` size, `text-tertiary`, only visible on hover or for large nodes.

**Interactions:**
- **Drag:** Pan the canvas.
- **Scroll:** Zoom in/out (0.5x to 3x).
- **Hover node:** Node glows (`accent-glow` shadow), connected edges brighten, label appears.
- **Click node:** Opens detail panel showing all memories containing that entity.
- **Double-click background:** Reset zoom.

**Overlay UI (on top of canvas):**
- Top-left: "Knowledge Graph" title + entity count.
- Top-right: Search node input, filter dropdown (by entity type).
- Bottom-left: Zoom controls (+, -, fit).
- Bottom-right: Legend (colored dots + labels).

### 6.4 Chrome Extension Popup

**Dimensions:** `360px × 480px`.

**Layout:**
- Header: Notable logo + memory count badge.
- Content area:
  - Extracted title: `heading-2`, truncated.
  - Extracted excerpt: `body`, 3 lines.
  - Metadata: Domain, estimated read time.
  - Tags: AI-suggested tags (chips) + user-editable input.
  - Collection selector: Dropdown.
- Footer: "Save to Notable" button (AI Action Button, full width).

**States:**
- **Extracting:** Skeleton loader in content area.
- **Ready:** Content populated, tags editable.
- **Saving:** Button shows spinner, disabled.
- **Success:** Button transforms to checkmark with `semantic-success` color, auto-closes after `2s`.
- **Error:** Inline error banner, retry button.

---

## 7. Animation & Motion

### Philosophy
Motion should feel **liquid and intelligent** — like the system is thinking, not like a generic web app. Avoid bouncy springs. Use smooth easing with slight inertia.

### Easing Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `ease-default` | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard transitions (150ms). |
| `ease-enter` | `cubic-bezier(0, 0, 0.2, 1)` | Elements appearing (200ms). |
| `ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Elements disappearing (150ms). |
| `ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful moments (success checkmark, like button). Rare. |

### Standard Durations

| Duration | Usage |
|----------|-------|
| `75ms` | Color changes, opacity shifts on hover. |
| `150ms` | Button presses, dropdown opens, tooltip appears. |
| `200ms` | Card hover lift, panel slides, modal enter. |
| `300ms` | Page transitions, sidebar collapse. |
| `500ms` | Toast enter/exit, graph node focus. |

### Specific Animations

**Card Hover**
```css
transition: transform 200ms ease-default, 
            background-color 150ms ease-default,
            box-shadow 200ms ease-default;
/* On hover: */
transform: translateY(-2px);
box-shadow: 0 4px 12px rgba(0,0,0,0.3);
```

**AI Streaming Cursor**
```css
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
/* Accent-colored vertical bar, 2px wide, blinking 1s infinite */
```

**Page Transition**
```css
/* Exit current page */
.exit { opacity: 1; transform: translateY(0); }
.exit-active { opacity: 0; transform: translateY(8px); transition: 150ms ease-exit; }

/* Enter new page */
.enter { opacity: 0; transform: translateY(8px); }
.enter-active { opacity: 1; transform: translateY(0); transition: 200ms ease-enter; }
```

**Toast Notification**
- Enter: Slide in from right + fade in (`300ms`, `ease-enter`).
- Exit: Slide out right + fade out (`200ms`, `ease-exit`).
- Auto-dismiss after `4s`.

**Graph Node Pulse (when AI is processing)**
```css
@keyframes node-pulse {
  0% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.4); }
  70% { box-shadow: 0 0 0 10px rgba(167, 139, 250, 0); }
  100% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0); }
}
/* 2s infinite, used on nodes being actively enriched */
```

**Skeleton Shimmer**
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
/* Linear gradient bg sliding across, 1.5s infinite */
```

---

## 8. Responsive Breakpoints

| Name | Width | Layout Changes |
|------|-------|----------------|
| `mobile` | < 640px | Single column. Sidebar becomes bottom nav drawer. Detail panel becomes full-screen overlay. Cards stack vertically. |
| `tablet` | 640px – 1024px | 2-column grid. Sidebar collapses to icon-only (`64px`). Detail panel becomes 50% width overlay. |
| `desktop` | 1024px – 1440px | Full 3-pane layout. 3-column grid. |
| `wide` | > 1440px | 3-column grid with increased gutters. Centered content with max-width constraints. Detail panel can be wider (`420px`). |

---

## 9. Iconography

**Library:** Lucide React (or equivalent SVG set).

**Rules:**
- Stroke width: `1.5px` (thin, elegant on dark backgrounds).
- Size: `16px` default, `20px` for nav items, `12px` for inline indicators.
- Color: Inherit from text color (`currentColor`).
- No filled icons except for: status indicators (online dot), rating stars, checkbox checked state.

**Key Icons:**
- Search, Home, Bookmark, Tag, Folder (Collection), Settings, Trash, Edit, External Link, ChevronDown, Sparkles (AI indicator), Brain (Knowledge Graph), MessageSquare (Q&A), Save, X, Menu, Zap (streaming).

---

## 10. Asset Guidelines

### Knowledge Graph Background
- Use the monochrome wave texture from image(1) as a **generative or procedural background**.
- It should be dark, subtle, and animated very slowly (gentle undulation).
- Opacity: `5-10%` when used behind UI, `30-50%` when used as a full-screen empty state.
- Never use it as a static image — it must feel alive.

### Empty States
- **No memories:** Organic wave visualization + centered text + primary CTA.
- **No search results:** Simplified wave lines + "No matches found" + suggestion chips.
- **Graph loading:** Pulsing node constellation that resolves into the actual graph.

### Thumbnails / Previews
- Always fetch `og:image` or screenshot.
- Apply a slight dark overlay (`rgba(0,0,0,0.2)`) to prevent bright images from breaking the dark theme.
- Fallback: Domain favicon on `bg-elevated` surface.

---

## 11. Accessibility (Dark Theme Specific)

### Contrast
- All text must meet **WCAG AA** (4.5:1 for normal text, 3:1 for large text).
- `text-primary` on `bg-surface`: ~15:1 ✅
- `text-secondary` on `bg-surface`: ~7:1 ✅
- `text-tertiary` on `bg-surface`: ~4.6:1 ✅ (minimum)

### Focus Management
- All interactive elements must have a visible focus ring: `2px solid accent-primary`, offset `2px`.
- Focus ring should animate in (`150ms`).
- Trap focus inside modals and command palette.

### Motion
- Respect `prefers-reduced-motion`:
  - Disable graph node pulse.
  - Disable page transition slide (use fade only).
  - Disable card hover lift (use color change only).
  - Disable wave background animation.

### Screen Readers
- AI-generated content must be marked with `aria-label="AI-generated summary"`.
- Streaming text should use `aria-live="polite"` on the container.
- Graph nodes need `role="button"` and descriptive `aria-label`s.

---

## 12. File Structure (Frontend)

```
notable-frontend/
├── app/
│   ├── layout.tsx              # Root layout, theme provider, fonts
│   ├── page.tsx                # Dashboard / Knowledge Base
│   ├── globals.css             # CSS variables, base styles
│   ├── graph/
│   │   └── page.tsx            # Full-screen knowledge graph
│   ├── ask/
│   │   └── page.tsx            # Standalone Q&A interface
│   └── settings/
│       └── page.tsx            # User preferences
├── components/
│   ├── ui/                     # Primitive components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── tag.tsx
│   │   ├── modal.tsx
│   │   ├── tooltip.tsx
│   │   ├── skeleton.tsx
│   │   └── toast.tsx
│   ├── layout/
│   │   ├── sidebar.tsx
│   │   ├── detail-panel.tsx
│   │   ├── app-shell.tsx
│   │   └── command-palette.tsx
│   ├── memory/
│   │   ├── memory-card.tsx
│   │   ├── memory-grid.tsx
│   │   ├── memory-list.tsx
│   │   ├── memory-detail.tsx
│   │   └── memory-skeleton.tsx
│   ├── ai/
│   │   ├── chat-message.tsx
│   │   ├── streaming-text.tsx
│   │   ├── citation-chip.tsx
│   │   └── thinking-indicator.tsx
│   └── graph/
│       ├── graph-canvas.tsx
│       ├── graph-node.tsx
│       ├── graph-edge.tsx
│       └── graph-controls.tsx
├── hooks/
│   ├── use-streaming-answer.ts
│   ├── use-graph-data.ts
│   ├── use-memory-search.ts
│   └── use-command-palette.ts
├── lib/
│   ├── utils.ts                # cn() helper, formatting
│   ├── api.ts                  # API client (memories, ask, graph)
│   └── constants.ts            # Design tokens mirror
├── types/
│   └── index.ts                # Memory, Chunk, Entity, Edge types
├── public/
│   └── textures/               # Generated wave textures (if static)
├── tailwind.config.ts          # Custom colors, spacing, animations
└── next.config.js
```

---

*Last updated: 2026-07-27*  
*Status: Ready for implementation*
