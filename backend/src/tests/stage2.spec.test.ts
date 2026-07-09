/**
 * Stage 2 — Spec Verification Tests
 *
 * Maps directly to the Stage 2 checklist:
 * 1. POST /memories with a URL returns 202 -> worker processes -> status ready.
 * 2. POST /memories/extension with pre-extracted content does the same.
 * 3. Duplicate URL returns existing memory with 200 and duplicate: true.
 * 4. Failed scrapes -> status failed with errorMessage.
 * 5. GET /memories/:id/status returns current status.
 *
 * Run: npx tsx src/tests/stage2.spec.test.ts
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.MONGODB_URL = process.env.MONGODB_URL ?? 'mongodb://localhost:27017/notable-test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

import mongoose from 'mongoose';
import axios from 'axios';
import { Queue, Worker } from 'bullmq';
import { MemoryModel } from '../models/memory.model.js';
import { ChunkModel } from '../models/chunk.model.js';
import { redis, memoryQueue } from '../config/queue.js';
import { memoryWorker } from '../workers/memory.worker.js';

// Dynamic import to avoid ESM import hoisting so env vars are set first
const appModule = await import('../index.js');
const app = appModule.default;

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
let _details: string[] = [];

async function test(label: string, fn: () => Promise<void>): Promise<void> {
  _details = [];
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
  console.log('📊 STAGE 2 SPEC VERIFICATION RESULTS');
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
// Setup and Teardown
// =============================================================================

const TEST_USER_ID = 'test-user-stage2-' + Date.now();
const API_URL = 'http://localhost:5001/api';

const authHeaders = {
  'x-test-user-id': TEST_USER_ID,
  'x-test-user-role': 'paid',
};

// Helper for waiting
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Wait for mongoose connection to be established by the imported app
for (let i = 0; i < 20; i++) {
  if (mongoose.connection.readyState === 1) break;
  await delay(250);
}

if (mongoose.connection.readyState !== 1) {
  console.error('❌ Mongoose connection timed out in test. Current state:', mongoose.connection.readyState);
  process.exit(1);
}

// Clear test database collections
await MemoryModel.deleteMany({});
await ChunkModel.deleteMany({});
await memoryQueue.drain(true);

await test('POST /memories: returns 202 Accepted and processes asynchronously to ready', async () => {
  const testUrl = 'https://en.wikipedia.org/wiki/TypeScript';

  // 1. Submit memory request
  info(`Submitting URL: ${testUrl}`);
  const response = await axios.post(
    `${API_URL}/memories`,
    { url: testUrl },
    { headers: authHeaders }
  );

  assert(response.status === 202, `Expected status 202, got ${response.status}`);
  const memory = response.data.memory;
  assert(memory.url === testUrl, 'URL mismatch in response');
  assert(memory.status === 'pending', `Expected pending status, got ${memory.status}`);
  info(`Memory ID: ${memory._id}, Initial status: ${memory.status}`);

  // 2. Poll status endpoint until it changes to ready
  let status = 'pending';
  let chunkCount = 0;
  for (let i = 0; i < 15; i++) {
    await delay(1000);
    const statusRes = await axios.get(`${API_URL}/memories/${memory._id}/status`, {
      headers: authHeaders,
    });
    status = statusRes.data.status;
    chunkCount = statusRes.data.chunkCount;
    info(`Poll ${i + 1}: status = ${status}, chunkCount = ${chunkCount}`);
    if (status === 'ready' || status === 'failed') break;
  }

  assert(status === 'ready', `Expected final status 'ready', got '${status}'`);
  assert(chunkCount > 0, `Expected chunkCount > 0, got ${chunkCount}`);

  // 3. Confirm MongoDB backup exists
  const dbMemory = await MemoryModel.findById(memory._id);
  assert(!!dbMemory, 'Memory document not found in DB');
  assert(dbMemory!.title.length > 0, 'Memory title not populated');
  assert(dbMemory!.status === 'ready', 'Memory status in DB not ready');
});

await test('POST /memories/extension: processes pre-extracted text directly without scraping', async () => {
  const extensionUrl = 'https://test-extension-page.com/article';
  const payload = {
    url: extensionUrl,
    title: 'Pre-Extracted Article Title',
    description: 'A mock article description from the browser meta tags.',
    content: 'This is the main body content of the article page. '.repeat(100),
    contentType: 'article',
    metadata: {
      author: 'Chrome Extension',
      siteName: 'Extension Test',
    },
  };

  // 1. Submit pre-extracted content
  info(`Submitting pre-extracted content for URL: ${extensionUrl}`);
  const response = await axios.post(
    `${API_URL}/memories/extension`,
    payload,
    { headers: authHeaders }
  );

  assert(response.status === 202, `Expected status 202, got ${response.status}`);
  const memory = response.data.memory;
  assert(memory.status === 'pending', `Expected pending status, got ${memory.status}`);

  // 2. Poll status endpoint until it becomes ready
  let status = 'pending';
  let chunkCount = 0;
  for (let i = 0; i < 15; i++) {
    await delay(1000);
    const statusRes = await axios.get(`${API_URL}/memories/${memory._id}/status`, {
      headers: authHeaders,
    });
    status = statusRes.data.status;
    chunkCount = statusRes.data.chunkCount;
    info(`Poll ${i + 1}: status = ${status}, chunkCount = ${chunkCount}`);
    if (status === 'ready' || status === 'failed') break;
  }

  assert(status === 'ready', `Expected final status 'ready', got '${status}'`);
  assert(chunkCount > 0, `Expected chunkCount > 0, got ${chunkCount}`);

  // 3. Verify Memory details
  const dbMemory = await MemoryModel.findById(memory._id);
  assert(dbMemory!.title === payload.title, 'Title mismatch');
  assert(dbMemory!.description === payload.description, 'Description mismatch');
  assert(dbMemory!.source === 'extension', 'Source mismatch');
});

await test('Deduplication: duplicate URL returns 200 and existing memory', async () => {
  const url = 'https://en.wikipedia.org/wiki/TypeScript';

  // 1. Send first request (should already exist from test 1)
  info(`Sending duplicate request for URL: ${url}`);
  const response = await axios.post(
    `${API_URL}/memories`,
    { url },
    { headers: authHeaders }
  );

  assert(response.status === 200, `Expected duplicate status 200, got ${response.status}`);
  assert(response.data.duplicate === true, 'Expected duplicate flag to be true');
  assert(!!response.data.memory, 'Expected memory object to be returned');
});

await test('Error Handling: invalid/failed scraping updates status to failed', async () => {
  const badUrl = 'https://httpstat.us/404';

  // 1. Submit bad URL
  info(`Submitting bad URL: ${badUrl}`);
  const response = await axios.post(
    `${API_URL}/memories`,
    { url: badUrl },
    { headers: authHeaders }
  );

  assert(response.status === 202, `Expected status 202, got ${response.status}`);
  const memory = response.data.memory;

  // 2. Poll status endpoint until it becomes failed
  let status = 'pending';
  let errorMessage = '';
  for (let i = 0; i < 15; i++) {
    await delay(1000);
    const statusRes = await axios.get(`${API_URL}/memories/${memory._id}/status`, {
      headers: authHeaders,
    });
    status = statusRes.data.status;
    errorMessage = statusRes.data.errorMessage;
    info(`Poll ${i + 1}: status = ${status}, error = ${errorMessage}`);
    if (status === 'ready' || status === 'failed') break;
  }

  assert(status === 'failed', `Expected final status 'failed', got '${status}'`);
  assert(!!errorMessage, 'Expected error message to be set');
});

// =============================================================================
// Run and Teardown
// =============================================================================

printResults();

const failed = results.filter((r) => !r.passed).length;

// Cleanup active connections so Node can exit cleanly
info('Cleaning up active connections...');
await memoryQueue.close();
await memoryWorker.close();
await redis.quit();
await mongoose.disconnect();

// Try to close Express server gracefully if it exists
if (global.gc) {
  // force garbage collection if needed
}

// Exit code based on test success
process.exit(failed > 0 ? 1 : 0);
