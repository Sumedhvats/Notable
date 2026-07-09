/**
 * Stage 1 Integration Tests — Embedding + Vector Store
 *
 * Requires real API keys in .env:
 *   JINA_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_NAME, MONGODB_URL
 *
 * Also requires the Pinecone index to exist (512 dims, cosine metric).
 *
 * Run: npx tsx src/tests/stage1.integration.test.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { embed, EmbeddingError } from '../services/embedding.service.js';
import {
  upsertChunks,
  query,
  querySimilar,
  deleteByMemory,
} from '../services/vector-store.service.js';
import { ChunkModel } from '../models/chunk.model.js';

// =============================================================================
// Test Framework
// =============================================================================

interface TestResult {
  label: string;
  passed: boolean;
  duration: number;
  details: string[];
  error?: string;
}

const results: TestResult[] = [];
const _details: string[] = [];

async function test(label: string, fn: () => Promise<void>): Promise<void> {
  _details.length = 0;
  const start = Date.now();
  try {
    await fn();
    results.push({ label, passed: true, duration: Date.now() - start, details: [..._details] });
  } catch (err) {
    results.push({
      label,
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
  console.log('📊 STAGE 1 INTEGRATION TEST RESULTS');
  console.log('='.repeat(70) + '\n');

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.label} (${r.duration}ms)`);
    for (const d of r.details) console.log(`   ℹ  ${d}`);
    if (r.error) console.log(`   ❌ Error: ${r.error}`);
    console.log('');
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`${passed}/${results.length} passed${failed ? ` — ${failed} FAILED` : ''}`);
}

// =============================================================================
// Test data
// =============================================================================

const TEST_USER_ID = 'test-user-stage1';
const TEST_MEMORY_ID = new mongoose.Types.ObjectId().toString();
const EXPECTED_DIMS = parseInt(process.env.JINA_EMBEDDING_DIMENSIONS ?? '512', 10);

// Connect to MongoDB before starting tests
const mongoUrl = process.env.MONGODB_URL;
if (!mongoUrl) {
  console.error('❌ MONGODB_URL not set — skipping integration tests');
  process.exit(1);
}
await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 5000 });

const TEST_CHUNKS = [
  { text: 'TypeScript is a strongly typed superset of JavaScript.', index: 0 },
  { text: 'It compiles down to plain JavaScript and runs anywhere JS runs.', index: 1 },
  { text: 'The TypeScript compiler catches type errors at compile time.', index: 2 },
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// =============================================================================
// Embedding tests
// =============================================================================

await test('embed: empty array → empty result', async () => {
  const vectors = await embed([]);
  assert(vectors.length === 0, `expected 0 vectors, got ${vectors.length}`);
});

await test('embed: single text → one vector with correct dimensions', async () => {
  const vectors = await embed(['Hello world']);
  assert(vectors.length === 1, `expected 1 vector, got ${vectors.length}`);
  assert(vectors[0].length === EXPECTED_DIMS, `expected ${EXPECTED_DIMS} dims, got ${vectors[0].length}`);
  info(`Vector dims: ${vectors[0].length}`);
  info(`First 5 values: ${vectors[0].slice(0, 5).map((v) => v.toFixed(4)).join(', ')}`);
});

await test('embed: multiple texts → one vector per text, in order', async () => {
  const texts = ['cat', 'dog', 'bird'];
  const vectors = await embed(texts);
  assert(vectors.length === texts.length, `expected ${texts.length}, got ${vectors.length}`);
  vectors.forEach((v, i) => {
    assert(v.length === EXPECTED_DIMS, `vector ${i} has wrong dims: ${v.length}`);
  });
});

await test('embed: semantically similar texts → high cosine similarity', async () => {
  const [v1, v2] = await embed([
    'TypeScript is a typed superset of JavaScript',
    'TypeScript adds types to JavaScript',
  ]);
  // Cosine similarity
  const dot = v1.reduce((sum, x, i) => sum + x * v2[i], 0);
  const mag1 = Math.sqrt(v1.reduce((s, x) => s + x * x, 0));
  const mag2 = Math.sqrt(v2.reduce((s, x) => s + x * x, 0));
  const similarity = dot / (mag1 * mag2);
  info(`Cosine similarity: ${similarity.toFixed(4)}`);
  assert(similarity > 0.80, `expected similarity > 0.80, got ${similarity.toFixed(4)}`);
});

await test('embed: semantically different texts → lower cosine similarity', async () => {
  const [v1, v2] = await embed([
    'TypeScript is a typed superset of JavaScript',
    'The cat sat on the mat and ate a rat',
  ]);
  const dot = v1.reduce((sum, x, i) => sum + x * v2[i], 0);
  const mag1 = Math.sqrt(v1.reduce((s, x) => s + x * x, 0));
  const mag2 = Math.sqrt(v2.reduce((s, x) => s + x * x, 0));
  const similarity = dot / (mag1 * mag2);
  info(`Cosine similarity (unrelated): ${similarity.toFixed(4)}`);
  assert(similarity < 0.95, `expected similarity < 0.95 for unrelated texts, got ${similarity.toFixed(4)}`);
});

await test('embed: no API key → throws EmbeddingError', async () => {
  const original = process.env.JINA_API_KEY;
  delete process.env.JINA_API_KEY;
  try {
    await embed(['test']);
    assert(false, 'should have thrown EmbeddingError');
  } catch (err) {
    assert(err instanceof EmbeddingError, `expected EmbeddingError, got ${(err as Error).name}`);
    info(`Error: ${(err as Error).message}`);
  } finally {
    process.env.JINA_API_KEY = original;
  }
});

// =============================================================================
// Vector store tests
// =============================================================================

let testVectors: number[][] = [];
let queryVector: number[] = [];
let deleteVerifyVector: number[] = [];

await test('vector store setup: embed test chunks and query text', async () => {
  const allTexts = [
    ...TEST_CHUNKS.map((c) => c.text),
    'What language compiles to JavaScript?',
    'TypeScript typed superset JavaScript compiler',
  ];
  const allVectors = await embed(allTexts);
  testVectors = allVectors.slice(0, 3);
  queryVector = allVectors[3];
  deleteVerifyVector = allVectors[4];
  assert(testVectors.length === TEST_CHUNKS.length, 'should have one vector per chunk');
  info(`Embedded ${testVectors.length} chunks + query vectors in one batch`);
});

await test('upsertChunks: writes to Pinecone and MongoDB', async () => {
  await upsertChunks(TEST_USER_ID, TEST_MEMORY_ID, TEST_CHUNKS, testVectors);

  const docs = await ChunkModel.find({ memoryId: TEST_MEMORY_ID }).lean();
  assert(docs.length === TEST_CHUNKS.length, `expected ${TEST_CHUNKS.length} docs in MongoDB, got ${docs.length}`);

  const sorted = docs.sort((a, b) => a.chunkIndex - b.chunkIndex);
  sorted.forEach((doc, i) => {
    assert(doc.chunkIndex === i, `doc ${i} has chunkIndex ${doc.chunkIndex}`);
    assert(doc.text === TEST_CHUNKS[i].text, `doc ${i} text mismatch`);
  });
  info(`MongoDB: ${docs.length} chunk docs saved`);
});

await test('upsertChunks: idempotent — second upsert replaces first', async () => {
  await upsertChunks(TEST_USER_ID, TEST_MEMORY_ID, TEST_CHUNKS, testVectors);
  const docs = await ChunkModel.find({ memoryId: TEST_MEMORY_ID }).lean();
  assert(docs.length === TEST_CHUNKS.length, `expected ${TEST_CHUNKS.length} docs after re-upsert, got ${docs.length}`);
  info('Idempotency confirmed — no duplicate docs');
});

await test('upsertChunks: mismatched chunks/vectors → throws', async () => {
  try {
    await upsertChunks(TEST_USER_ID, TEST_MEMORY_ID, TEST_CHUNKS, [testVectors[0]]);
    assert(false, 'should have thrown');
  } catch (err) {
    assert((err as Error).message.includes('length mismatch'), `unexpected error: ${(err as Error).message}`);
    info('Correctly threw on mismatch');
  }
});

// Delay for Pinecone indexing
await delay(3000);

await test('query: returns scored chunks for a related query', async () => {
  const matches = await query(TEST_USER_ID, queryVector, 3);
  info(`Returned ${matches.length} matches`);
  if (matches.length > 0) {
    info(`Top match: score=${matches[0].score.toFixed(4)}, memoryId=${matches[0].memoryId}, chunkIndex=${matches[0].chunkIndex}`);
    assert(matches[0].score > 0, 'top match should have a positive score');
  }
  assert(matches.length > 0, 'expected at least one result');
});

await test('querySimilar: finds chunks similar to a given memory', async () => {
  const similar = await querySimilar(TEST_USER_ID, TEST_MEMORY_ID, 3);
  info(`Returned ${similar.length} similar chunks`);
  assert(similar.length > 0, 'expected at least one result');
});

await test('deleteByMemory: removes vectors from Pinecone and docs from MongoDB', async () => {
  await deleteByMemory(TEST_USER_ID, TEST_MEMORY_ID);

  const docs = await ChunkModel.find({ memoryId: TEST_MEMORY_ID }).lean();
  assert(docs.length === 0, `expected 0 docs after delete, got ${docs.length}`);
  info('MongoDB: chunk docs deleted');

  // Delay for Pinecone deletion processing
  await delay(2000);

  // Confirm vectors are gone — query should return no matches for this memory
  const matches = await query(TEST_USER_ID, deleteVerifyVector, 10);
  const fromThisMemory = matches.filter((m) => m.memoryId === TEST_MEMORY_ID);
  assert(fromThisMemory.length === 0, `expected 0 matches from deleted memory, got ${fromThisMemory.length}`);
  info('Pinecone: vectors deleted');
});

// =============================================================================
// Run
// =============================================================================

printResults();

await mongoose.disconnect();

const failed = results.filter((r) => !r.passed).length;
process.exit(failed > 0 ? 1 : 0);
