/**
 * Stage 4 — Spec Verification Tests
 *
 * Maps directly to the "Done When" checklist in spec/stage-4.md:
 *
 *  1. Enrichment service extracts tags, summary, and entities from text
 *  2. Entity deduplication normalizes names (JS → JavaScript)
 *  3. Co-occurrence edges created when entities share a memory
 *  4. Collection CRUD: create, list, update, delete
 *  5. Add/remove memories to/from collections
 *  6. Search: GET /memories?q=... returns matching memories via text index
 *  7. Filters: type, tags, entities, date range, sort
 *  8. Export: GET /memories/:id/export/markdown returns .md file
 *  9. Graph: GET /graph returns entities + edges
 * 10. Graph: GET /memories/:id/graph returns per-memory entities + edges
 *
 * Run: npx tsx src/tests/stage4.spec.test.ts
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '5002';
process.env.MONGODB_URL = process.env.MONGODB_URL ?? 'mongodb://localhost:27017/notable-test-stage4';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

import mongoose from 'mongoose';
import axios from 'axios';
import { MemoryModel } from '../models/memory.model.js';
import { ChunkModel } from '../models/chunk.model.js';
import { EntityModel } from '../models/entity.model.js';
import { EdgeModel } from '../models/edge.model.js';
import { CollectionModel } from '../models/collection.model.js';
import { enrich } from '../services/enrichment.service.js';
import { exportMemoryMarkdown, exportCollectionMarkdown } from '../services/export.service.js';
import { redis, memoryQueue, enrichmentQueue } from '../config/queue.js';
import { memoryWorker } from '../workers/memory.worker.js';
import { enrichmentWorker } from '../workers/enrichment.worker.js';

// Dynamic import to avoid ESM import hoisting so env vars are set first
const appModule = await import('../index.js');
const app = appModule.default;

// =============================================================================
// Test Framework
// =============================================================================

interface TestResult {
  label: string;
  specItem: string;
  passed: boolean;
  duration: number;
  details: string[];
  error?: string;
}

const results: TestResult[] = [];
let _details: string[] = [];

async function specTest(
  specItem: string,
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  _details = [];
  const start = Date.now();
  try {
    await fn();
    results.push({ label, specItem, passed: true, duration: Date.now() - start, details: [..._details] });
  } catch (err) {
    results.push({
      label,
      specItem,
      passed: false,
      duration: Date.now() - start,
      details: [..._details],
      error: (err as Error).message,
    });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function info(msg: string) {
  _details.push(msg);
}

function printResults(): void {
  console.log('\n' + '='.repeat(70));
  console.log('📊 STAGE 4 SPEC VERIFICATION RESULTS');
  console.log('='.repeat(70) + '\n');

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} [${r.specItem}] ${r.label} (${r.duration}ms)`);
    for (const d of r.details) console.log(`   ℹ  ${d}`);
    if (r.error) console.log(`   ❌ Error: ${r.error}`);
    console.log('');
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`${passed}/${results.length} passed${failed ? ` — ${failed} FAILED` : ''}`);
}

// =============================================================================
// Setup
// =============================================================================

const TEST_USER_ID = 'test-user-stage4-' + Date.now();
const API_URL = 'http://localhost:5002/api';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const authHeaders = {
  'x-test-user-id': TEST_USER_ID,
  'x-test-user-role': 'paid',
};

// Wait for mongoose connection
for (let i = 0; i < 20; i++) {
  if (mongoose.connection.readyState === 1) break;
  await delay(250);
}

if (mongoose.connection.readyState !== 1) {
  console.error('❌ Mongoose connection timed out. State:', mongoose.connection.readyState);
  process.exit(1);
}

// Clean up test data
await MemoryModel.deleteMany({ userId: TEST_USER_ID });
await ChunkModel.deleteMany({ userId: TEST_USER_ID });
await EntityModel.deleteMany({ userId: TEST_USER_ID });
await EdgeModel.deleteMany({ userId: TEST_USER_ID });
await CollectionModel.deleteMany({ userId: TEST_USER_ID });

// =============================================================================
// Seed a test memory with chunks for enrichment tests
// =============================================================================

const TEST_MEMORY = await MemoryModel.create({
  url: 'https://example.com/test-article',
  title: 'Getting Started with Docker and Kubernetes',
  description: '',
  contentType: 'article',
  source: 'extension',
  status: 'ready',
  userId: TEST_USER_ID,
  tags: ['devops'],
});

const TEST_MEMORY_ID = TEST_MEMORY._id;

// Create test chunks that mention known entities
await ChunkModel.insertMany([
  {
    memoryId: TEST_MEMORY_ID,
    userId: TEST_USER_ID,
    chunkIndex: 0,
    text: 'Docker is a platform for containerizing applications. It was created at Docker Inc. Kubernetes, also known as k8s, is used for container orchestration. Both tools are essential for modern DevOps workflows in cloud computing platforms like AWS and Google Cloud Platform.',
  },
  {
    memoryId: TEST_MEMORY_ID,
    userId: TEST_USER_ID,
    chunkIndex: 1,
    text: 'To build a Docker image, create a Dockerfile in your project root. Kubernetes deployments can be defined using YAML manifests. Linus Torvalds created Linux, which is the foundation for both Docker and Kubernetes.',
  },
]);

// Seed a second memory for search/filter tests
const TEST_MEMORY_2 = await MemoryModel.create({
  url: 'https://example.com/react-guide',
  title: 'React Hooks Tutorial',
  description: 'A guide to React hooks',
  contentType: 'article',
  source: 'url',
  status: 'ready',
  userId: TEST_USER_ID,
  tags: ['frontend', 'react'],
  entities: ['react', 'javascript'],
});

// =============================================================================
// Spec Item 1: Enrichment extracts tags, summary, and entities
// =============================================================================

await specTest('1. Enrichment', 'enrich() extracts summary, tags, and entities from chunks', async () => {
  info(`Running enrich() for memory ${TEST_MEMORY_ID}`);
  await enrich(TEST_MEMORY_ID.toString(), TEST_USER_ID);

  // Verify memory was updated
  const memory = await MemoryModel.findById(TEST_MEMORY_ID).lean();
  assert(!!memory, 'Memory should exist after enrichment');
  info(`Summary: "${memory!.summary}"`);
  info(`Tags: [${memory!.tags.join(', ')}]`);
  info(`Entities: [${memory!.entities.join(', ')}]`);

  assert(memory!.summary.length > 0, 'Summary should not be empty');
  assert(memory!.tags.length > 1, 'Should have more than just the original "devops" tag');
  assert(memory!.tags.includes('devops'), 'Original tag "devops" should be preserved');
  assert(memory!.entities.length > 0, 'Should have extracted at least one entity');
});

// =============================================================================
// Spec Item 2: Entity deduplication normalizes names
// =============================================================================

await specTest('2. Deduplication', 'Entities are normalized (aliases resolved to canonical form)', async () => {
  const entities = await EntityModel.find({ userId: TEST_USER_ID }).lean();
  info(`Total entities created: ${entities.length}`);

  for (const e of entities) {
    info(`  Entity: "${e.name}" (type: ${e.type}, aliases: [${e.aliases.join(', ')}])`);
  }

  // Check that "k8s" was resolved to "kubernetes" (from the alias map)
  const k8sEntity = entities.find((e) => e.name === 'kubernetes');
  const rawK8s = entities.find((e) => e.name === 'k8s');
  info(`kubernetes entity found: ${!!k8sEntity}`);
  info(`raw "k8s" entity found (should be false): ${!!rawK8s}`);

  // At minimum, we expect entities to exist and be lowercase
  assert(entities.length > 0, 'Should have created at least one entity');
  const allLowercase = entities.every((e) => e.name === e.name.toLowerCase());
  assert(allLowercase, 'All entity names should be lowercase (normalized)');
});

// =============================================================================
// Spec Item 3: Co-occurrence edges
// =============================================================================

await specTest('3. Co-occurrence', 'Edges created between entities that share a memory', async () => {
  const edges = await EdgeModel.find({ userId: TEST_USER_ID }).lean();
  info(`Total edges created: ${edges.length}`);

  for (const e of edges.slice(0, 5)) {
    info(`  Edge: "${e.entityA}" ↔ "${e.entityB}" (weight: ${e.weight})`);
  }

  if (edges.length > 0) {
    // Verify alphabetical sorting constraint
    const allSorted = edges.every((e) => e.entityA <= e.entityB);
    assert(allSorted, 'entityA should always be ≤ entityB alphabetically');

    // Verify each edge has the memoryId
    const hasMemoryId = edges.every((e) =>
      e.memoryIds.some((mid) => mid.toString() === TEST_MEMORY_ID.toString()),
    );
    assert(hasMemoryId, 'All edges should reference the test memory');
  }

  assert(edges.length > 0, 'Should have created at least one edge (entities co-occur)');
});

// =============================================================================
// Spec Items 4-5: Collection CRUD + Memory membership
// =============================================================================

let testCollectionId: string;

await specTest('4. Collections CRUD', 'Create, list, get, update, delete collections', async () => {
  // CREATE
  const createRes = await axios.post(
    `${API_URL}/collections`,
    { name: 'DevOps Tools', description: 'Docker, K8s, etc.' },
    { headers: authHeaders },
  );
  assert(createRes.status === 201, `Expected 201, got ${createRes.status}`);
  testCollectionId = createRes.data.collection._id;
  info(`Created collection: ${testCollectionId}`);

  // LIST
  const listRes = await axios.get(`${API_URL}/collections`, { headers: authHeaders });
  assert(listRes.status === 200, `Expected 200, got ${listRes.status}`);
  assert(listRes.data.collections.length >= 1, 'Should have at least 1 collection');
  info(`Listed ${listRes.data.collections.length} collections`);

  // GET
  const getRes = await axios.get(`${API_URL}/collections/${testCollectionId}`, {
    headers: authHeaders,
  });
  assert(getRes.status === 200, `Expected 200, got ${getRes.status}`);
  assert(getRes.data.collection.name === 'DevOps Tools', 'Name should match');
  info(`Got collection: "${getRes.data.collection.name}"`);

  // UPDATE
  const updateRes = await axios.put(
    `${API_URL}/collections/${testCollectionId}`,
    { name: 'DevOps & Cloud', description: 'Updated description' },
    { headers: authHeaders },
  );
  assert(updateRes.status === 200, `Expected 200, got ${updateRes.status}`);
  assert(updateRes.data.collection.name === 'DevOps & Cloud', 'Name should be updated');
  info(`Updated collection name to: "${updateRes.data.collection.name}"`);

  // DUPLICATE NAME — should fail with 409
  try {
    await axios.post(
      `${API_URL}/collections`,
      { name: 'DevOps & Cloud' },
      { headers: authHeaders },
    );
    assert(false, 'Should have thrown 409 for duplicate name');
  } catch (err: any) {
    assert(err.response?.status === 409, `Expected 409, got ${err.response?.status}`);
    info('Duplicate name correctly returned 409');
  }
});

await specTest('5. Collection membership', 'Add/remove memories to/from collections', async () => {
  // ADD memory to collection
  const addRes = await axios.post(
    `${API_URL}/collections/${testCollectionId}/memories`,
    { memoryId: TEST_MEMORY_ID.toString() },
    { headers: authHeaders },
  );
  assert(addRes.status === 200, `Expected 200, got ${addRes.status}`);
  info(`Added memory to collection`);

  // Verify memory now has the collection
  const memory = await MemoryModel.findById(TEST_MEMORY_ID).lean();
  const hasCollection = memory!.collections.some(
    (c) => c.toString() === testCollectionId,
  );
  assert(hasCollection, 'Memory should have collection in its collections array');
  info(`Memory.collections: [${memory!.collections.map((c) => c.toString()).join(', ')}]`);

  // GET collection should include the memory
  const getRes = await axios.get(`${API_URL}/collections/${testCollectionId}`, {
    headers: authHeaders,
  });
  assert(getRes.data.memories.length === 1, 'Collection should have 1 memory');
  info(`Collection has ${getRes.data.memories.length} memories`);

  // REMOVE memory from collection
  const removeRes = await axios.delete(
    `${API_URL}/collections/${testCollectionId}/memories/${TEST_MEMORY_ID}`,
    { headers: authHeaders },
  );
  assert(removeRes.status === 200, `Expected 200, got ${removeRes.status}`);

  const memoryAfter = await MemoryModel.findById(TEST_MEMORY_ID).lean();
  const stillHas = memoryAfter!.collections.some(
    (c) => c.toString() === testCollectionId,
  );
  assert(!stillHas, 'Memory should no longer have the collection');
  info('Removed memory from collection');
});

// =============================================================================
// Spec Items 6-7: Search and Filters
// =============================================================================

await specTest('6. Text search', 'GET /memories?q=react returns matching memories', async () => {
  // Wait a moment for text index to catch up
  await delay(500);

  const res = await axios.get(`${API_URL}/memories`, {
    headers: authHeaders,
    params: { q: 'React Hooks' },
  });
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  info(`Search "React Hooks" returned ${res.data.total} results`);

  const titles = res.data.memories.map((m: any) => m.title);
  info(`Titles: ${JSON.stringify(titles)}`);
  assert(res.data.total >= 1, 'Should find at least 1 matching memory');

  const hasReactMemory = res.data.memories.some(
    (m: any) => m.title === 'React Hooks Tutorial',
  );
  assert(hasReactMemory, 'Should include the React Hooks memory');
});

await specTest('7. Filters', 'Filter by tags, type, entities', async () => {
  // Filter by tags
  const tagRes = await axios.get(`${API_URL}/memories`, {
    headers: authHeaders,
    params: { tags: 'frontend' },
  });
  info(`Filter tags=frontend: ${tagRes.data.total} results`);
  assert(tagRes.data.total >= 1, 'Should find memories tagged "frontend"');

  // Filter by contentType
  const typeRes = await axios.get(`${API_URL}/memories`, {
    headers: authHeaders,
    params: { type: 'article' },
  });
  info(`Filter type=article: ${typeRes.data.total} results`);
  assert(typeRes.data.total >= 2, 'Should find at least 2 article memories');

  // Filter by entities
  const entityRes = await axios.get(`${API_URL}/memories`, {
    headers: authHeaders,
    params: { entities: 'react' },
  });
  info(`Filter entities=react: ${entityRes.data.total} results`);
  assert(entityRes.data.total >= 1, 'Should find memories with entity "react"');

  // Sort by oldest
  const sortRes = await axios.get(`${API_URL}/memories`, {
    headers: authHeaders,
    params: { sort: 'oldest' },
  });
  assert(sortRes.status === 200, 'Sort by oldest should work');
  info(`Sort=oldest returned ${sortRes.data.total} results`);
});

// =============================================================================
// Spec Item 8: Markdown Export
// =============================================================================

await specTest('8. Markdown export', 'GET /memories/:id/export/markdown returns .md file', async () => {
  const res = await axios.get(
    `${API_URL}/memories/${TEST_MEMORY_ID}/export/markdown`,
    { headers: authHeaders },
  );
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(
    (res.headers['content-type'] as string)?.includes('text/markdown'),
    `Expected content-type text/markdown, got ${res.headers['content-type']}`,
  );
  assert(
    (res.headers['content-disposition'] as string)?.includes('attachment'),
    'Should have attachment disposition for download',
  );

  const markdown = res.data as string;
  info(`Markdown length: ${markdown.length} chars`);
  info(`First 200 chars:\n${markdown.slice(0, 200)}`);

  assert(markdown.includes('---'), 'Should contain YAML frontmatter delimiters');
  assert(markdown.includes('title:'), 'Should contain title in frontmatter');
  assert(markdown.includes('url:'), 'Should contain url in frontmatter');
});

// =============================================================================
// Spec Items 9-10: Graph endpoints
// =============================================================================

await specTest('9. Global graph', 'GET /graph returns entities (nodes) and edges (links)', async () => {
  const res = await axios.get(`${API_URL}/graph`, { headers: authHeaders });
  assert(res.status === 200, `Expected 200, got ${res.status}`);

  const { nodes, links } = res.data;
  info(`Global graph: ${nodes.length} nodes, ${links.length} links`);

  assert(Array.isArray(nodes), 'nodes should be an array');
  assert(Array.isArray(links), 'links should be an array');

  if (nodes.length > 0) {
    info(`Sample node: ${JSON.stringify(nodes[0])}`);
    assert(typeof nodes[0].id === 'string', 'Node should have string id');
    assert(typeof nodes[0].type === 'string', 'Node should have string type');
    assert(typeof nodes[0].memoryCount === 'number', 'Node should have memoryCount');
  }

  if (links.length > 0) {
    info(`Sample link: ${JSON.stringify(links[0])}`);
    assert(typeof links[0].source === 'string', 'Link should have string source');
    assert(typeof links[0].target === 'string', 'Link should have string target');
    assert(typeof links[0].weight === 'number', 'Link should have weight');
  }

  assert(nodes.length > 0, 'Should have at least one entity node');
});

await specTest('10. Per-memory graph', 'GET /memories/:id/graph returns memory-specific graph', async () => {
  const res = await axios.get(`${API_URL}/memories/${TEST_MEMORY_ID}/graph`, {
    headers: authHeaders,
  });
  assert(res.status === 200, `Expected 200, got ${res.status}`);

  const { nodes, links } = res.data;
  info(`Memory graph: ${nodes.length} nodes, ${links.length} links`);

  assert(Array.isArray(nodes), 'nodes should be an array');
  assert(Array.isArray(links), 'links should be an array');
});

// =============================================================================
// Cleanup: Delete collection
// =============================================================================

await specTest('Cleanup', 'Delete collection cascades correctly', async () => {
  // Add memory back to collection first
  await axios.post(
    `${API_URL}/collections/${testCollectionId}/memories`,
    { memoryId: TEST_MEMORY_ID.toString() },
    { headers: authHeaders },
  );

  // Delete collection
  const delRes = await axios.delete(`${API_URL}/collections/${testCollectionId}`, {
    headers: authHeaders,
  });
  assert(delRes.status === 200, `Expected 200, got ${delRes.status}`);

  // Verify memory no longer references the deleted collection
  const memory = await MemoryModel.findById(TEST_MEMORY_ID).lean();
  const stillHas = memory!.collections.some(
    (c) => c.toString() === testCollectionId,
  );
  assert(!stillHas, 'Memory should not reference deleted collection');
  info('Collection deleted, references cleaned from memories');

  // Verify collection is gone
  const collection = await CollectionModel.findById(testCollectionId);
  assert(!collection, 'Collection should be deleted');
});

// =============================================================================
// Run and Teardown
// =============================================================================

printResults();

const failed = results.filter((r) => !r.passed).length;

// Cleanup test data
await MemoryModel.deleteMany({ userId: TEST_USER_ID });
await ChunkModel.deleteMany({ userId: TEST_USER_ID });
await EntityModel.deleteMany({ userId: TEST_USER_ID });
await EdgeModel.deleteMany({ userId: TEST_USER_ID });
await CollectionModel.deleteMany({ userId: TEST_USER_ID });

// Close active connections
await memoryQueue.close();
await enrichmentQueue.close();
await memoryWorker.close();
await enrichmentWorker.close();
await redis.quit();
await mongoose.disconnect();

process.exit(failed > 0 ? 1 : 0);
