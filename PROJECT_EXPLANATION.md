# Notable — Project Explanation & Current Codebase Documentation

> **Notable** is an AI-powered personal knowledge base and bookmark manager. It automatically extracts, chunks, embeds, and indexes web pages into a PostgreSQL vector database (`pgvector`), enabling semantic search, streaming RAG Q&A, and knowledge graph entity extraction.

---

## 🏗 Current Architecture & Component Breakdown

```mermaid
graph TD
    subgraph Chrome Extension (extension/)
        EXT_CONTENT[content.ts / extractor.ts] -->|Page Extraction| EXT_API[utils/api.ts]
        EXT_API -->|POST /memories/extension| API_GW[Express API Server]
    end

    subgraph Backend Core (backend/src/)
        API_GW --> AUTH[better-auth & Auth Middleware]
        API_GW --> MEM_CTRL[Memory Controller & Routes]
        API_GW --> ASK_CTRL[Ask Controller & Routes]
        API_GW --> GRAPH_CTRL[Graph Controller & Routes]
        API_GW --> COLL_CTRL[Collection Controller & Routes]

        MEM_CTRL --> QUEUE[BullMQ + Redis Queue]
        QUEUE --> MEM_WORKER[memory.worker.ts]
        QUEUE --> ENRICH_WORKER[enrichment.worker.ts]

        MEM_WORKER --> SCRAPER[scraper.service.ts]
        MEM_WORKER --> CHUNKER[chunker.service.ts]
        MEM_WORKER --> EMBED[embedding.service.ts]
        EMBED --> VEC_STORE[vector-store.service.ts]

        ENRICH_WORKER --> ENRICH_SVC[enrichment.service.ts]
        ENRICH_SVC --> ENTITY_MODEL[entity.model.ts & edge.model.ts]

        ASK_CTRL --> QA_SVC[qa.service.ts]
        QA_SVC --> VEC_STORE
        QA_SVC -->|SSE Stream| CLIENT[API Consumers]
    end

    subgraph Infrastructure
        VEC_STORE --> PG[(PostgreSQL + pgvector)]
        QUEUE --> REDIS[(Redis)]
    end
```

---

## 🛠 Currently Implemented Modules

### 1. Scraper & Extraction Layer (`backend/src/services/scraper.service.ts`)
* Implements **10+ site-specific extractors** (Twitter/X, Reddit, YouTube, Medium, Substack, GitHub, Wikipedia, News, Generic blogs).
* Handles DOM parsing, HTML stripping, metadata extraction (`title`, `og:image`, `author`, `published_at`, `favicon`), and text truncation to ~10,000 characters.

### 2. RAG Pipeline Services
* **Chunker Service (`backend/src/services/chunker.service.ts`):** Splits raw scraped content into overlapping text chunks (`Chunk` model) to maintain semantic context boundaries.
* **Embedding Service (`backend/src/services/embedding.service.ts`):** Generates dense vector embeddings using OpenAI (`text-embedding-3-small`) with fallback support.
* **Vector Store Service (`backend/src/services/vector-store.service.ts`):** Stores and queries vectors directly in PostgreSQL via `pgvector` cosine similarity metrics.

### 3. Background Workers & Queues
* **Memory Worker (`backend/src/workers/memory.worker.ts`):** Listens to BullMQ job queues to asynchronously scrape, chunk, embed, and index new memories without blocking HTTP response loops.
* **Enrichment Worker (`backend/src/workers/enrichment.worker.ts`):** Asynchronously generates AI summaries, auto-tags, extracts named entities, and builds co-occurrence edges.

### 4. Q&A & Streaming Engine (`backend/src/services/qa.service.ts` & `ask.controller.ts`)
* Performs vector similarity search across chunk embeddings to retrieve relevant source context.
* Formulates natural language answers using OpenAI models and streams the response to the client using **Server-Sent Events (SSE)** (`POST /ask/stream`).
* Returns cited source memory IDs and text chunks alongside the answer.

### 5. Entity Extraction & Knowledge Graph API (`backend/src/services/enrichment.service.ts` & `graph.controller.ts`)
* **Entity & Edge Models (`entity.model.ts`, `edge.model.ts`):** Stores extracted entities and weighted co-occurrence edges between entities.
* **Graph Controller (`backend/src/controllers/graph.controller.ts`):** Exposes graph nodes and links via `GET /graph` for client-side visualizers.

### 6. Memory & Collection CRUD Controllers
* **Memory Controller (`memory.controller.ts`):** Supports creating, reading, updating, searching, and deleting saved memories (`GET /memories`, `POST /memories`, `DELETE /memories/:id`).
* **Collection Controller (`collection.controller.ts`):** Manages bookmark grouping and collections (`POST /collections`, `GET /collections`).
* **Export Service (`export.service.ts`):** Generates Markdown exports of saved memories.

### 7. Chrome Extension Core (`extension/src/`)
* **Content Extractor (`extension/src/utils/extractor.ts`):** Injects on-demand into browser tabs to extract clean content from Twitter, Reddit, YouTube, Medium, and generic sites directly from the client DOM.
* **Storage Utils (`extension/src/utils/storage.ts`):** Manages local storage state (`chrome.storage.local`).
* **API Bridge (`extension/src/utils/api.ts`):** Connects Chrome Extension to backend endpoints (`/memories/extension`).

---

## 📂 Current Codebase Inventory

```
Notable/
├── backend/
│   ├── src/
│   │   ├── config/             # Environment & app constants
│   │   ├── controllers/
│   │   │   ├── ask.controller.ts        # SSE streaming Q&A controller
│   │   │   ├── collection.controller.ts # Collection management
│   │   │   ├── graph.controller.ts      # Entity graph data endpoint
│   │   │   └── memory.controller.ts     # Memory CRUD operations
│   │   ├── lib/
│   │   │   └── auth.ts                  # better-auth initialization
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts       # Session authentication guard
│   │   │   ├── authorize.middleware.ts  # Role authorization
│   │   │   ├── rateLimit.middleware.ts  # Rate limiter
│   │   │   └── validate.middleware.ts   # Request schema validation
│   │   ├── models/
│   │   │   ├── chunk.model.ts           # Chunk schema
│   │   │   ├── collection.model.ts      # Collection schema
│   │   │   ├── edge.model.ts            # Graph edge schema
│   │   │   ├── entity.model.ts          # Graph entity schema
│   │   │   └── memory.model.ts          # Memory schema
│   │   ├── routes/
│   │   │   ├── ask.routes.ts            # /ask endpoints
│   │   │   ├── collection.routes.ts     # /collections endpoints
│   │   │   ├── graph.routes.ts          # /graph endpoints
│   │   │   └── memory.routes.ts         # /memories endpoints
│   │   ├── services/
│   │   │   ├── chunker.service.ts       # Text chunking logic
│   │   │   ├── embedding.service.ts     # OpenAI vector embedding generation
│   │   │   ├── enrichment.service.ts    # Summary, tag & entity extraction
│   │   │   ├── export.service.ts        # Markdown export generator
│   │   │   ├── qa.service.ts            # Context retrieval & LLM Q&A
│   │   │   ├── scraper.service.ts       # 10+ site DOM scrapers
│   │   │   └── vector-store.service.ts  # Pgvector search & storage
│   │   └── workers/
│   │       ├── enrichment.worker.ts     # BullMQ enrichment task consumer
│   │       └── memory.worker.ts         # BullMQ memory processing consumer
│   ├── index.ts                         # Express application entrypoint
│   ├── package.json
│   └── tsconfig.json
├── extension/
│   ├── manifest.json                    # Manifest V3 extension configuration
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── content.ts                   # Content script entrypoint
│       └── utils/
│           ├── api.ts                   # Backend API client for extension
│           ├── extractor.ts             # Client DOM scraper & site selectors
│           └── storage.ts               # chrome.storage API wrappers
├── docker-compose.yml                   # PostgreSQL + pgvector + Redis container services
└── implementation_plan.md
```

---

## ⚡ Execution Commands

### Infrastructure Setup
```bash
# Start PostgreSQL (pgvector) and Redis
docker-compose up -d
```

### Run Backend
```bash
cd backend
bun install
bun run dev
```
