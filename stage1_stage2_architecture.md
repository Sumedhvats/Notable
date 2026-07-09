# Notable Ingestion & Processing Pipeline (Stage 1 & 2)

This guide walks you through how **Notable** saves web content and processes it for AI search. It is written assuming you are new to AI search concepts like **RAG**, **embeddings**, **chunking**, and **vector databases**.

---

## 1. Core Concepts Explained

Before looking at the code, let's understand the core concepts.

### What is RAG (Retrieval-Augmented Generation)?
An AI model (like ChatGPT, Claude, or Groq) is trained on general knowledge. It doesn't know about *your* personal bookmarks, a private Slack channel, or a specific blog post you read yesterday.
Instead of sending a massive document to the AI every time you ask a question (which is slow and expensive), we use **RAG**:
1. **Retrieve**: When you ask a question, we search our database for the most relevant *paragraphs* of the articles you've saved.
2. **Augment**: We insert those paragraphs into a prompt (e.g. *"Answer this question using only this context: [Paragraphs]"*).
3. **Generate**: We send this combined prompt to the AI, which generates a precise answer based on your saved articles.

### What is Chunking?
You can't embed an entire book or a 20-page article as a single entry. If you do, the specific details get lost in the noise, and it exceeds the maximum input limits of embedding models.
**Chunking** is the process of breaking a long document into smaller, coherent pieces (typically ~500 words or tokens) with slight overlaps so that meaning isn't cut off at the boundaries.

### What is an Embedding?
An embedding model converts text into a list of numbers (a coordinate vector, e.g., `[0.12, -0.05, 0.91, ...]`). 
* Similar texts (e.g., *"How do I install TypeScript?"* and *"Setup guide for TypeScript"*) will have coordinates that are very close to each other in mathematical space.
* Unrelated texts (e.g., *"The cat sat on the mat"*) will have coordinates far away.
By comparing these lists of numbers (using math like *Cosine Similarity*), we can find semantically related content instantly without relying on simple keyword matching.

### What is a Vector Database?
Traditional databases (like MongoDB or SQL) search by matching exact fields. A **Vector Database** (like Pinecone) is designed specifically to index and search coordinates (embeddings) at lighting speed. It tells you which saved paragraphs are closest to your search query.

---

## 2. System Architecture

The workflow is split into two halves:
1. **API Ingestion (Stage 2)**: Accepts the request, checks for duplicates, saves a placeholder in MongoDB, enqueues the job to Redis, and returns `202 Accepted` to the user immediately.
2. **Asynchronous Worker (Stage 1 & 2)**: Runs in the background, pulls jobs from the queue, scrapes pages, chunks the text, embeds it via Jina AI, and stores it in Pinecone.

```mermaid
sequenceDiagram
    autonumber
    actor User as Chrome Extension / Web App
    participant API as Express API Server
    participant Mongo as MongoDB
    participant Redis as Redis (BullMQ Queue)
    participant Worker as BullMQ Worker
    participant Jina as Jina AI API
    participant PC as Pinecone Index

    User->>API: POST /api/memories (URL)
    API->>Mongo: Check unique index {url, userId}
    alt Already exists
        Mongo-->>API: Return existing Memory
        API-->>User: 200 OK (duplicate: true)
    else New Memory
        API->>Mongo: Create Memory (status: 'pending')
        API->>Redis: Enqueue job payload
        API-->>User: 202 Accepted { memoryId, status: 'pending' }
    end

    Note over Redis,Worker: Background Execution
    Redis->>Worker: Pull job
    Worker->>Mongo: Set status: 'processing'
    Worker->>Worker: Scrape URL -> Chunk -> Embed
    Worker->>Jina: POST /v1/embeddings (Get coordinates)
    Jina-->>Worker: [ [0.12, -0.04, ...], ... ]
    Worker->>PC: Upsert vectors (namespace = userId)
    Worker->>Mongo: Backup chunk text to ChunkModel
    Worker->>Mongo: Set status: 'ready', chunkCount: N
```

---

## 3. Detailed Code Walkthrough

### Part A: The Async Queue Ingestion (`src/controllers/memory.controller.ts`)
When a user submits a URL, we do not make them wait for scraping and embedding. We check if they saved it before, insert a document, throw a job in Redis, and respond.

Here is the controller logic for `POST /api/memories`:

```typescript
export async function createFromUrl(req: AuthenticatedRequest, res: Response) {
  const { url } = req.body;
  const userId = req.userId!;

  // 1. Check if the user already saved this URL
  const existing = await MemoryModel.findOne({ url, userId });
  if (existing) {
    return res.status(200).json({ memory: existing, duplicate: true });
  }

  let memory;
  try {
    // 2. Insert document as 'pending'
    memory = await MemoryModel.create({
      url,
      userId,
      status: 'pending',
      source: 'url',
      contentType: 'generic',
    });
  } catch (err: any) {
    // Handle race conditions: if two requests come at the exact same millisecond,
    // MongoDB unique index will throw E11000. We catch it and return the duplicate.
    if (err.code === 11000) {
      const duplicate = await MemoryModel.findOne({ url, userId });
      if (duplicate) {
        return res.status(200).json({ memory: duplicate, duplicate: true });
      }
    }
    throw err;
  }

  // 3. Queue the background processing job in Redis
  await memoryQueue.add(`memory-url-${memory._id}`, {
    memoryId: memory._id.toString(),
    userId,
    mode: 'url',
    url,
  });

  // 4. Return immediately to the user
  return res.status(202).json({ memory });
}
```

---

### Part B: The Chunker Service (`src/services/chunker.service.ts`)
Once the worker picks up the job, it scrapes the page and chunks the clean text. We use a **3-bucket strategy** to preserve the structure of the document:

```typescript
export async function chunk(text: string, contentType: ContentType): Promise<Chunk[]> {
  const totalTokens = tokenLen(text);

  // BUCKET 1: Short content - Do not split to preserve atomic meaning
  if (totalTokens <= CHUNK_SIZE) {
    return [{ text, index: 0 }];
  }

  // BUCKET 2: Structured Content (Articles, GitHub, HN, Wikipedia)
  if (['article', 'reddit', 'github', 'stackoverflow', 'wikipedia', 'hn'].includes(contentType)) {
    return splitByHeaders(text);
  }

  // BUCKET 3: Unstructured Content (YouTube transcripts, logs, generic)
  return splitBySentences(text);
}
```

#### The Header Anchor Splitting Code:
In markdown documents, we split by headings (`##`, `###`). If a section is too long, we split it into smaller paragraphs, but we **prepend** the nearest heading to each chunk so the context isn't lost.

```typescript
async function splitByHeaders(text: string): Promise<Chunk[]> {
  // First pass: Split by headers
  const headerDocs = await markdownSplitter.createDocuments([text]);
  const finalChunks: string[] = [];

  for (const doc of headerDocs) {
    const content = doc.pageContent;
    // Extract nearest markdown heading from this chunk
    const headerMatch = content.match(/^(#{1,6}\s+.*)$/m);
    const header = headerMatch ? headerMatch[1].trim() : '';

    if (tokenLen(content) > CHUNK_SIZE) {
      // Sub-split long sections recursively by paragraphs
      const subDocs = await paragraphSplitter.createDocuments([content]);
      for (const sub of subDocs) {
        const subContent = sub.pageContent;
        // Prepend the heading prefix to each sub-chunk
        const chunkText = (header && !subContent.startsWith(header))
          ? `${header}\n${subContent}`
          : subContent;
        finalChunks.push(chunkText);
      }
    } else {
      finalChunks.push(content);
    }
  }

  return finalChunks.map((text, index) => ({ text, index }));
}
```

---

### Part C: The Embedding Service (`src/services/embedding.service.ts`)
Next, we take the chunked texts and send them to Jina AI to generate mathematical vectors.

```typescript
async function embedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new EmbeddingError('JINA_API_KEY is not set');

  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      const response = await axios.post(
        'https://api.jina.ai/v1/embeddings',
        {
          input: texts,
          model: 'jina-embeddings-v4',
          dimensions: 512, // Matryoshka learning: tells Jina to output 512 numbers instead of 2048
          task: 'retrieval.passage',
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 30000,
        }
      );
      return response.data.data.map((d: any) => d.embedding);
    } catch (err) {
      // Handle rate limits (429) using exponential backoff
      if ((err as AxiosError).response?.status === 429 && attempt < MAX_RETRIES) {
        const delay = Math.round(Math.pow(2, attempt) * 1000);
        await sleep(delay);
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

### Part D: The Vector Store Service (`src/services/vector-store.service.ts`)
Now we store the Jina coordinates in Pinecone, and write a copy of the plain text to MongoDB.

```typescript
export async function upsertChunks(
  userId: string,
  memoryId: mongoose.Types.ObjectId,
  chunks: Chunk[],
  vectors: number[][]
): Promise<void> {
  const memoryIdStr = memoryId.toString();
  const index = getIndex();
  // Isolate users by placing vectors inside namespaces
  const ns = index.namespace(userId);

  // 1. Prepare Pinecone Records
  const records = chunks.map((c, i) => ({
    id: `${memoryIdStr}_${c.index}`, // Deterministic vector ID
    values: vectors[i],             // Coordinating numbers (embedding)
    metadata: {
      memoryId: memoryIdStr,
      chunkIndex: c.index,
      userId,
      chunkText: c.text,            // Save copy of text inside Pinecone for faster Q&A retrieval
    },
  }));

  // 2. Write to Pinecone
  await ns.upsert({ records });

  // 3. Write copy to MongoDB ChunkModel for backups
  await ChunkModel.deleteMany({ memoryId });
  await ChunkModel.insertMany(
    chunks.map((c) => ({
      memoryId,
      userId,
      chunkIndex: c.index,
      text: c.text,
    }))
  );
}
```

---

### Part E: Querying Chunks (How Retrieval Works)
When a user asks a question, we embed the question and ask Pinecone to return the nearest vectors.

```typescript
export async function query(
  userId: string,
  vector: number[],
  topK = 5
): Promise<ScoredChunk[]> {
  const index = getIndex();
  const ns = index.namespace(userId);

  // Query Pinecone for vectors matching the question's coordinates
  const result = await ns.query({
    vector,
    topK,
    includeMetadata: true, // Asks Pinecone to return the chunkText saved with the vector
  });

  return (result.matches ?? []).map((m) => {
    const { memoryId, chunkIndex } = parseVectorId(m.id);
    return {
      chunkId: m.id,
      score: m.score ?? 0,               // Relevance score (closer to 1 = more relevant)
      text: (m.metadata?.chunkText as string) ?? '',
      memoryId,
      chunkIndex,
    };
  });
}
```

---

## 4. How It Works End-to-End

Let's trace what happens when you save an article called *"How to learn TypeScript"* with URL `https://example.com/ts`:

1. **API Ingestion**:
   * You click save. Your client makes a request to `POST /api/memories`.
   * The controller verifies you haven't saved `https://example.com/ts` before.
   * It creates a record in MongoDB: `{ url: 'https://example.com/ts', status: 'pending', userId: 'user_123' }`.
   * It enqueues a job payload: `{ memoryId: 'mem_abc', mode: 'url', url: '...' }` into Redis.
   * Your client receives a `202 Accepted` response.

2. **Background Processing**:
   * The worker pulls the job from Redis.
   * The worker scrapes `https://example.com/ts` and gets the text content.
   * The text is chunked into 3 paragraphs (since it's a long article).
   * The 3 paragraph chunks are sent to Jina AI, which returns 3 arrays of numbers (e.g. `[0.05, -0.12, ...]`, size 512).
   * These vectors are saved in Pinecone under the namespace `user_123`.
   * The plain texts are saved in MongoDB `chunks` collection.
   * The memory status in MongoDB is updated to `'ready'`.

3. **Asking a Question (Stage 3 Preview)**:
   * You search: *"Where do I start with TypeScript?"*
   * Your question is converted into an embedding vector by Jina AI.
   * We query Pinecone namespace `user_123` with this vector.
   * Pinecone returns the 3 most similar chunks from *"How to learn TypeScript"*.
   * We pass those 3 chunks + your question to Groq (LLM).
   * Groq streams the final answer back to your screen.
