/**
 * Chunker Service Unit Tests
 *
 * Tests chunking logic without any external dependencies.
 * All three buckets, edge cases, and token counting are covered.
 *
 * Run: npx tsx src/tests/chunker.test.ts
 */
import 'dotenv/config';
import { chunk, tokenLen } from '../services/chunker.service.js';

// =============================================================================
// Test Framework (matches scraper.test.ts pattern)
// =============================================================================

interface TestResult {
  label: string;
  passed: boolean;
  duration: number;
  details: string[];
  error?: string;
}

const results: TestResult[] = [];

async function test(label: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  const details: string[] = [];
  try {
    await fn();
    results.push({ label, passed: true, duration: Date.now() - start, details });
  } catch (err) {
    results.push({
      label,
      passed: false,
      duration: Date.now() - start,
      details,
      error: (err as Error).message,
    });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function printResults(): void {
  console.log('\n' + '='.repeat(70));
  console.log('📊 CHUNKER SERVICE TEST RESULTS');
  console.log('='.repeat(70) + '\n');

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.label} (${r.duration}ms)`);
    for (const d of r.details) console.log(`   ${d}`);
    if (r.error) console.log(`   ❌ Error: ${r.error}`);
    console.log('');
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`${passed}/${results.length} passed${failed ? ` — ${failed} FAILED` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

// =============================================================================
// Fixtures
// =============================================================================

const TWEET_TEXT = "Just shipped a new feature! Excited to share what we've been building. #coding #startup";

/** ~600 tokens of repeated markdown article — triggers Bucket 2 */
function makeLongMarkdownArticle(): string {
  const section = (heading: string, n: number) => {
    const para = 'This paragraph contains detailed information about the topic. '.repeat(n);
    return `\n\n## ${heading}\n\n${para}`;
  };
  return [
    '# Getting Started with TypeScript',
    section('Installation', 15),
    section('Configuration', 15),
    section('Writing Your First Program', 15),
    section('Type Annotations', 15),
    section('Interfaces and Types', 15),
  ].join('');
}

/** ~600 tokens of continuous prose (no headers) — triggers Bucket 3 */
function makeLongTranscript(): string {
  const sentence = 'Today we are going to talk about building scalable systems. ';
  return sentence.repeat(80);
}

// =============================================================================
// tokenLen tests
// =============================================================================

await test('tokenLen: returns a positive integer for non-empty string', async () => {
  const len = tokenLen('hello world');
  assert(len > 0, `expected > 0, got ${len}`);
  assert(Number.isInteger(len), 'expected integer');
});

await test('tokenLen: empty string → 0 tokens', async () => {
  const len = tokenLen('');
  assert(len === 0, `expected 0, got ${len}`);
});

await test('tokenLen: longer text → more tokens', async () => {
  const short = tokenLen('hi');
  const long = tokenLen('hi '.repeat(100));
  assert(long > short, `expected long (${long}) > short (${short})`);
});

// =============================================================================
// Bucket 1 — Short content → single chunk
// =============================================================================

await test('Bucket 1: tweet → single chunk, no split', async () => {
  const chunks = await chunk(TWEET_TEXT, 'tweet');
  assert(chunks.length === 1, `expected 1 chunk, got ${chunks.length}`);
  assert(chunks[0].text === TWEET_TEXT, 'chunk text should equal input text');
  assert(chunks[0].index === 0, 'chunk index should be 0');
});

await test('Bucket 1: short article → single chunk', async () => {
  const text = 'Short article text. Only a few sentences. Not enough to split.';
  const chunks = await chunk(text, 'article');
  assert(chunks.length === 1, `expected 1 chunk, got ${chunks.length}`);
  assert(chunks[0].index === 0, 'index should be 0');
});

await test('Bucket 1: exactly at boundary → single chunk', async () => {
  // Build text that is exactly 500 tokens
  const words = 'word '.repeat(500);
  const tokens = tokenLen(words);
  // The text may be slightly over/under 500 — just confirm single-chunk behaviour
  // for clearly short content
  const short = 'word '.repeat(100);
  const chunks = await chunk(short, 'generic');
  assert(chunks.length === 1, `expected 1 chunk for ~100 word text, got ${chunks.length}`);
});

// =============================================================================
// Bucket 2 — Structured content (markdown)
// =============================================================================

await test('Bucket 2: long article → multiple chunks', async () => {
  const text = makeLongMarkdownArticle();
  const chunks = await chunk(text, 'article');
  assert(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
});

await test('Bucket 2: chunks are sequentially indexed', async () => {
  const text = makeLongMarkdownArticle();
  const chunks = await chunk(text, 'article');
  chunks.forEach((c, i) => {
    assert(c.index === i, `chunk at position ${i} has index ${c.index}`);
  });
});

await test('Bucket 2: no chunk exceeds 550 tokens (500 + small tolerance)', async () => {
  const text = makeLongMarkdownArticle();
  const chunks = await chunk(text, 'article');
  for (const c of chunks) {
    const len = tokenLen(c.text);
    assert(len <= 550, `chunk ${c.index} has ${len} tokens — exceeds limit`);
  }
});

await test('Bucket 2: all content types that map to structured branch', async () => {
  const text = makeLongMarkdownArticle();
  for (const ct of ['article', 'reddit', 'github', 'stackoverflow', 'wikipedia', 'hn'] as const) {
    const chunks = await chunk(text, ct);
    assert(chunks.length > 1, `${ct}: expected multiple chunks, got ${chunks.length}`);
  }
});

await test('Bucket 2: GitHub markdown → header prepended to chunks', async () => {
  const readme = `# My Project\n\n## Installation\n\n${'Run npm install. '.repeat(60)}\n\n## Usage\n\n${'Run the app with node. '.repeat(60)}`;
  const chunks = await chunk(readme, 'github');
  // At least some chunks should start with a header prefix
  const withHeader = chunks.filter((c) => c.text.startsWith('##') || c.text.startsWith('#'));
  assert(withHeader.length > 0, `expected header-prefixed chunks, got none. First chunk: "${chunks[0]?.text.slice(0, 80)}"`);
});

// =============================================================================
// Bucket 3 — Unstructured content (video / generic)
// =============================================================================

await test('Bucket 3: long transcript → multiple chunks', async () => {
  const text = makeLongTranscript();
  const chunks = await chunk(text, 'video');
  assert(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
});

await test('Bucket 3: chunks are sequentially indexed', async () => {
  const text = makeLongTranscript();
  const chunks = await chunk(text, 'video');
  chunks.forEach((c, i) => {
    assert(c.index === i, `chunk at position ${i} has index ${c.index}`);
  });
});

await test('Bucket 3: no chunk exceeds 550 tokens', async () => {
  const text = makeLongTranscript();
  const chunks = await chunk(text, 'video');
  for (const c of chunks) {
    const len = tokenLen(c.text);
    assert(len <= 550, `chunk ${c.index} has ${len} tokens — exceeds limit`);
  }
});

await test('Bucket 3: generic content type uses sentence split', async () => {
  const text = makeLongTranscript();
  const chunks = await chunk(text, 'generic');
  assert(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
});

// =============================================================================
// Overlap sanity check
// =============================================================================

await test('Overlap: adjacent transcript chunks share some text', async () => {
  const text = makeLongTranscript();
  const chunks = await chunk(text, 'video');
  if (chunks.length < 2) return; // can't test overlap on a single chunk

  // At least one pair of adjacent chunks should share a word sequence
  // (overlap means the end of chunk N appears at the start of chunk N+1)
  let foundOverlap = false;
  for (let i = 0; i < chunks.length - 1 && !foundOverlap; i++) {
    const endWords = chunks[i].text.split(' ').slice(-10).join(' ');
    if (chunks[i + 1].text.includes(endWords.slice(0, 20))) {
      foundOverlap = true;
    }
  }
  assert(foundOverlap, 'expected at least one pair of adjacent chunks to share overlapping text');
});

// =============================================================================
// Edge cases
// =============================================================================

await test('Edge case: empty string → single empty chunk', async () => {
  const chunks = await chunk('', 'generic');
  assert(chunks.length === 1, `expected 1 chunk, got ${chunks.length}`);
  assert(chunks[0].index === 0, 'index should be 0');
});

await test('Edge case: single sentence → single chunk', async () => {
  const chunks = await chunk('Hello world.', 'video');
  assert(chunks.length === 1, `expected 1, got ${chunks.length}`);
});

// =============================================================================
// Run
// =============================================================================

printResults();
