# Stage 1 — Chunker + Embedding + Vector Store

~3 days. Build the three services that turn scraped text into searchable vectors.

## In Scope

- Chunker service — hybrid content-type-aware splitting with real token counting
- Embedding service — Voyage AI REST API wrapper
- Vector store service — Pinecone upsert/query/delete
- Chunk model — MongoDB backup of chunk text

## Out of Scope

- Memory model / CRUD (Stage 2)
- BullMQ pipeline (Stage 2)
- Q&A (Stage 3)

---

## Chunking Strategy — Hybrid (Content-Type-Aware)

Content falls into three buckets. Each gets a different split strategy.

Splitting is handled by **LangChain's text splitter library** (`@langchain/textsplitters`). `js-tiktoken` is plugged in as the `lengthFunction` so all size/overlap measurements are in real tokens, not characters.

### Bucket 1: Short content — single chunk
If the entire text is under ~500 tokens, don't split it at all. One chunk = the whole memory.

Applies to: tweets, Reddit posts, arXiv abstracts, short news items.

**Why:** Splitting a 280-char tweet into pieces would destroy its meaning. The whole thing is atomic.

### Bucket 2: Structured content — `MarkdownHeaderTextSplitter` + `RecursiveCharacterTextSplitter`
Content with clear structural markers (markdown headers, paragraph breaks).

Applies to: blog posts, GitHub READMEs, Wikipedia, Stack Overflow, Medium articles, HN posts.

**Strategy:**
1. Run `MarkdownHeaderTextSplitter` on `["##", "###"]` — it splits by header and attaches the nearest heading as metadata (`{ header: "## Installation" }`) to every resulting document
2. For any document still > 500 tokens, pass it through `RecursiveCharacterTextSplitter` (separators: `["\n\n", "\n", " "]`) to paragraph-split further
3. **Prepend the header metadata to each chunk's text** — e.g., `"## Installation\nRun npm install..."`. This anchors the embedding to the *installation* topic rather than the generic phrase, a significant retrieval quality win for ~10 extra tokens.

**Why:** `MarkdownHeaderTextSplitter` naturally preserves document structure and propagates header context to sub-chunks, eliminating hand-rolled header detection.

### Bucket 3: Unstructured content — `RecursiveCharacterTextSplitter` with sentence separators
Content with no structural markers — raw speech, no paragraph breaks.

Applies to: YouTube transcripts, raw text scraped from unusual pages.

**Strategy:**
1. Use `RecursiveCharacterTextSplitter` with separators `["\n\n", ". ", "? ", "! ", "\n", " "]`
2. `chunkSize = 500` (tokens), `chunkOverlap = 50` (tokens)
3. The recursive fallback order naturally tries sentence boundaries before falling back to word/character splits

**Why:** A naive character-split on a YouTube transcript cuts mid-sentence at arbitrary boundaries. The recursive separator list keeps meaning intact by preferring sentence-level splits.

### Overlap
- **~50 tokens** of overlap between adjacent chunks (`chunkOverlap = 50`)
- Only applies to Bucket 2 and 3 — Bucket 1 (single chunk) has no overlap

### Token Counting
- Use **`js-tiktoken`** for accurate token counting (cl100k encoding is close enough to Voyage's tokenizer for sizing purposes)
- Passed as the `lengthFunction` to all `RecursiveCharacterTextSplitter` instances so `chunkSize`/`chunkOverlap` are measured in real tokens
- Fallback: character count × 0.25 if tokenizer fails to initialize

---

## Key Decisions

- **Chunk text backed up to MongoDB** — enables re-embedding if the model changes, and backup/restore independent of Pinecone
- **Voyage AI model configurable via env var** (`VOYAGE_MODEL`) — default `voyage-3-lite` (512 dims) so switching models doesn't require code changes
- **Pinecone namespace = userId** — isolates user data, no filter needed on queries
- **Vector IDs = `{memoryId}_{chunkIndex}`** — deterministic, enables upsert idempotency
- **Chunk size = ~500 tokens** — balanced between precision and context per retrieval hit

---

## Files

| File | What |
|---|---|
| `[NEW] src/models/chunk.model.ts` | `{ memoryId, userId, chunkIndex, text, createdAt }` with compound unique index `{ memoryId, chunkIndex }` |
| `[NEW] src/services/chunker.service.ts` | `chunk(text, contentType) → Array<{ text, index }>` — implements hybrid strategy above |
| `[NEW] src/services/embedding.service.ts` | `embed(texts[]) → number[][]` via Voyage AI, batched up to 128, with exponential backoff on 429 |
| `[NEW] src/services/vector-store.service.ts` | `upsertChunks()`, `query()`, `querySimilar()`, `deleteByMemory()` |

### Chunker internals

```
const tokenLen = (text) => encode(text).length  // js-tiktoken

const recursiveSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 50,
  lengthFunction: tokenLen,
})

chunker.chunk(text, contentType):
  if tokenLen(text) <= 500:
    return [{ text, index: 0 }]           // Bucket 1: single chunk

  if contentType in ['article', 'reddit', 'github', 'stackoverflow', 'wikipedia', 'hn']:
    return splitByHeaders(text)            // Bucket 2: structured

  if contentType in ['video', 'generic']:
    return splitBySentences(text)          // Bucket 3: unstructured

splitByHeaders(text):
  1. MarkdownHeaderTextSplitter(["##", "###"]).splitText(text)
     → produces docs with metadata.header = nearest heading
  2. For each doc where tokenLen(doc.text) > 500:
       further split with recursiveSplitter, propagate metadata.header
  3. Prepend metadata.header to each chunk's text
     → e.g. "## Installation\n" + chunkText

splitBySentences(text):
  1. RecursiveCharacterTextSplitter({
       separators: ["\n\n", ". ", "? ", "! ", "\n", " "],
       chunkSize: 500, chunkOverlap: 50, lengthFunction: tokenLen
     }).splitText(text)
```

---

## Env Vars to Add

```
VOYAGE_API_KEY=
VOYAGE_MODEL=voyage-3-lite
VOYAGE_DIMENSIONS=512
PINECONE_API_KEY=
PINECONE_INDEX_NAME=notable
```

## Deps to Install

```
js-tiktoken
@langchain/textsplitters
```

---

## Done When

- `chunk("tweet text", 'tweet')` → single chunk, no split
- `chunk(longArticle, 'article')` → chunks split on headers, each prefixed with nearest heading, ~500 tokens, ~50 overlap
- `chunk(youtubeTranscript, 'video')` → chunks split on sentence boundaries, ~500 tokens, ~50 overlap
- `embed(["hello world"])` → returns 512-dim vector from Voyage AI
- `upsertChunks(...)` writes vectors to Pinecone AND saves chunk text to MongoDB
- `query(...)` returns relevant chunks with scores
- `deleteByMemory(...)` cleans up both Pinecone vectors and MongoDB chunks
- Pinecone index `notable` created (512 dims, cosine metric)
- Voyage AI + Pinecone API keys in `.env`
