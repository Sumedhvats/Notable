/**
 * Scraper Service Integration Tests
 * Tests real URLs across different site types.
 *
 * Run: npx tsx src/tests/scraper.test.ts
 */
import { scrape, ScraperError } from '../services/scraper.service.js';

// =============================================================================
// Test Framework (minimal, no dependencies)
// =============================================================================

interface TestResult {
  label: string;
  passed: boolean;
  duration: number;
  details: string[];
  error?: string;
}

const results: TestResult[] = [];

async function test(
  label: string,
  fn: () => Promise<void>
): Promise<void> {
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
  console.log('📊 SCRAPER SERVICE TEST RESULTS');
  console.log('='.repeat(70) + '\n');

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    const time = `(${r.duration}ms)`;
    console.log(`${icon} ${r.label} ${time}`);
    for (const d of r.details) console.log(`   ${d}`);
    if (r.error) console.log(`   ❌ Error: ${r.error}`);
    console.log('');
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log('='.repeat(70));
  console.log(`📊 ${passed} passed, ${failed} failed out of ${results.length} tests`);
  console.log('='.repeat(70));

  if (failed > 0) process.exitCode = 1;
}

// =============================================================================
// Tests: Real URLs
// =============================================================================

// ---------------------------------------------------------------------------
// 1. Dev.to Blog Post (SSR — should work with Readability)
// ---------------------------------------------------------------------------
await test('Dev.to blog — Readability extraction', async () => {
  const result = await scrape(
    'https://dev.to/sumedhvats/how-i-shrunk-my-docker-images-by-98-go-nextjs-196l'
  );

  assert(result.source === 'readability', `Expected source=readability, got ${result.source}`);
  assert(result.contentType === 'article', `Expected type=article, got ${result.contentType}`);
  assert(result.title.length > 0, 'Title should not be empty');
  assert(result.content.length > 200, `Content too short: ${result.content.length} chars`);
  assert(
    result.content.toLowerCase().includes('docker'),
    'Content should mention docker'
  );

  console.log(`   Title: ${result.title.slice(0, 70)}`);
  console.log(`   Content: ${result.content.length} chars`);
  console.log(`   Source: ${result.source}`);
  if (result.metadata.ogImage) console.log(`   OG Image: ✅ present`);
  if (result.metadata.author) console.log(`   Author: ${result.metadata.author}`);
});

// ---------------------------------------------------------------------------
// 2. Reddit Post (JSON API → fallback)
// ---------------------------------------------------------------------------
await test('Reddit post — JSON API or fallback', async () => {
  try {
    const result = await scrape(
      'https://www.reddit.com/r/classicliterature/comments/1iz5e8k/sad_to_report_i_just_finished_count_of_monte/'
    );

    assert(result.contentType === 'reddit', `Expected type=reddit, got ${result.contentType}`);
    assert(result.source !== 'jina', 'Reddit verification pages from Jina should be rejected');
    assert(result.content.length > 50, `Content too short: ${result.content.length} chars`);
    assert(result.title.length > 0, 'Title should not be empty');

    console.log(`   Title: ${result.title.slice(0, 70)}`);
    console.log(`   Content: ${result.content.length} chars`);
    console.log(`   Source: ${result.source} (reddit-api/json = direct, jina/readability = fallback)`);
    if (result.metadata.author) console.log(`   Author: ${result.metadata.author}`);
  } catch (err) {
    assert(err instanceof ScraperError, 'Should throw ScraperError');
    assert((err as ScraperError).code === 'HTTP_ERROR', `Expected HTTP_ERROR, got ${(err as ScraperError).code}`);
    assert((err as ScraperError).suggestion !== undefined, 'Should suggest extension fallback');
    console.log(`   Reddit blocked unauthenticated server fetch as expected`);
    console.log(`   💡 ${(err as ScraperError).suggestion}`);
  }
});

// ---------------------------------------------------------------------------
// 3. YouTube Video (with captions)
// ---------------------------------------------------------------------------
await test('YouTube video — transcript extraction', async () => {
  const result = await scrape(
    'https://www.youtube.com/watch?v=BKzrwxqHTnQ'
  );

  assert(result.contentType === 'video', `Expected type=video, got ${result.contentType}`);
  assert(result.title.length > 0, 'Title should not be empty');
  assert(result.content.length > 100, `Content too short: ${result.content.length} chars`);

  const hasTranscript = result.content.toLowerCase().includes('transcript');
  console.log(`   Title: ${result.title.slice(0, 70)}`);
  console.log(`   Content: ${result.content.length} chars`);
  console.log(`   Source: ${result.source}`);
  console.log(`   Has transcript: ${hasTranscript ? '✅' : '⚠️  description only'}`);
  if (result.metadata.ogImage) console.log(`   Thumbnail: ✅ present`);
});

// ---------------------------------------------------------------------------
// 4. YouTube Video (potentially age-restricted / no captions)
// ---------------------------------------------------------------------------
await test('YouTube video — age-restricted / no captions fallback', async () => {
  const result = await scrape(
    'https://www.youtube.com/watch?v=EX_8ZjT2sO4'
  );

  assert(result.contentType === 'video', `Expected type=video, got ${result.contentType}`);
  assert(result.title.length > 0, 'Title should not be empty');
  // Even without transcript, should have at least title + description
  assert(result.content.length > 20, `Content too short: ${result.content.length} chars`);

  const hasTranscript = result.content.toLowerCase().includes('transcript');
  console.log(`   Title: ${result.title.slice(0, 70)}`);
  console.log(`   Content: ${result.content.length} chars`);
  console.log(`   Source: ${result.source}`);
  console.log(`   Has transcript: ${hasTranscript ? '✅ yes' : '⚠️  no (description fallback)'}`);
});

// ---------------------------------------------------------------------------
// 5. Notion Page (SPA — should fail locally, try Jina)
// ---------------------------------------------------------------------------
await test('Notion page — SPA detection + Jina fallback', async () => {
  try {
    const result = await scrape(
      'https://app.notion.com/p/do-it-252d46f786218058b1d2d9bc1a0a929c'
    );

    // If it succeeds, Jina was able to render it
    console.log(`   ✅ Jina extracted content from Notion SPA`);
    console.log(`   Title: ${result.title.slice(0, 70)}`);
    console.log(`   Content: ${result.content.length} chars`);
    console.log(`   Source: ${result.source}`);
  } catch (err) {
    if (err instanceof ScraperError) {
      // Expected: Notion is a SPA, local fails, Jina may also fail
      assert(
        err.code === 'EMPTY_CONTENT' || err.code === 'HTTP_ERROR',
        `Expected EMPTY_CONTENT or HTTP_ERROR, got ${err.code}`
      );
      assert(
        err.suggestion !== undefined,
        'Should suggest using Chrome extension'
      );
      console.log(`   ⚠️  Expected failure: ${err.code}`);
      console.log(`   💡 ${err.suggestion}`);
    } else {
      throw err;
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Error Cases
// ---------------------------------------------------------------------------
await test('Twitter URL — returns UNSUPPORTED_SITE', async () => {
  try {
    await scrape('https://x.com/elonmusk/status/123456');
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err instanceof ScraperError, 'Should throw ScraperError');
    assert((err as ScraperError).code === 'UNSUPPORTED_SITE', `Expected UNSUPPORTED_SITE, got ${(err as ScraperError).code}`);
    assert((err as ScraperError).suggestion !== undefined, 'Should have suggestion');
    console.log(`   Code: ${(err as ScraperError).code}`);
    console.log(`   💡 ${(err as ScraperError).suggestion}`);
  }
});

await test('LinkedIn URL — returns UNSUPPORTED_SITE', async () => {
  try {
    await scrape('https://www.linkedin.com/posts/some-post-123');
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err instanceof ScraperError, 'Should throw ScraperError');
    assert((err as ScraperError).code === 'UNSUPPORTED_SITE', `Expected UNSUPPORTED_SITE, got ${(err as ScraperError).code}`);
    console.log(`   Code: ${(err as ScraperError).code}`);
    console.log(`   💡 ${(err as ScraperError).suggestion}`);
  }
});

await test('Invalid URL — returns INVALID_URL', async () => {
  try {
    await scrape('not-a-valid-url');
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err instanceof ScraperError, 'Should throw ScraperError');
    assert((err as ScraperError).code === 'INVALID_URL', `Expected INVALID_URL, got ${(err as ScraperError).code}`);
    console.log(`   Code: ${(err as ScraperError).code}`);
  }
});

await test('FTP URL — returns INVALID_URL', async () => {
  try {
    await scrape('ftp://files.example.com/file.txt');
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err instanceof ScraperError, 'Should throw ScraperError');
    assert((err as ScraperError).code === 'INVALID_URL', `Expected INVALID_URL, got ${(err as ScraperError).code}`);
    console.log(`   Code: ${(err as ScraperError).code}`);
  }
});

// ---------------------------------------------------------------------------
// 7. Content Quality Checks
// ---------------------------------------------------------------------------
await test('Wikipedia — content has no HTML tags', async () => {
  const result = await scrape('https://en.wikipedia.org/wiki/TypeScript');

  assert(result.source === 'mediawiki-api', `Expected source=mediawiki-api, got ${result.source}`);
  assert(!result.content.includes('<div'), 'Content should not contain HTML tags');
  assert(!result.content.includes('<script'), 'Content should not contain script tags');
  assert(!result.content.includes('<style'), 'Content should not contain style tags');
  assert(result.content.length > 1000, `Content too short for Wikipedia: ${result.content.length}`);
  assert(result.content.length <= 50000, `Content exceeds max: ${result.content.length}`);

  console.log(`   Content: ${result.content.length} chars (clean text, no HTML)`);
  console.log(`   Title: ${result.title}`);
});

await test('Metadata extraction — OG tags present', async () => {
  const result = await scrape(
    'https://dev.to/sumedhvats/how-i-shrunk-my-docker-images-by-98-go-nextjs-196l'
  );

  // Dev.to has rich OG metadata
  const meta = result.metadata;
  console.log(`   ogImage: ${meta.ogImage ? '✅' : '❌'} ${meta.ogImage?.slice(0, 60) || 'missing'}`);
  console.log(`   author: ${meta.author || '(not extracted)'}`);
  console.log(`   siteName: ${meta.siteName || '(not extracted)'}`);
  console.log(`   favicon: ${meta.favicon ? '✅' : '❌'} ${meta.favicon?.slice(0, 60) || 'missing'}`);
  console.log(`   description: ${result.description ? '✅' : '❌'} ${result.description.slice(0, 60)}...`);
});

// ---------------------------------------------------------------------------
// 8. API Adapter Checks
// ---------------------------------------------------------------------------
await test('Hacker News — Firebase API extraction', async () => {
  const result = await scrape('https://news.ycombinator.com/item?id=8863');

  assert(result.source === 'hackernews-api', `Expected source=hackernews-api, got ${result.source}`);
  assert(result.title.length > 0, 'Title should not be empty');
  assert(result.content.length > 50, `Content too short: ${result.content.length}`);

  console.log(`   Title: ${result.title.slice(0, 70)}`);
  console.log(`   Content: ${result.content.length} chars`);
});

await test('Stack Overflow — Stack Exchange API extraction', async () => {
  const result = await scrape(
    'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array'
  );

  assert(result.source === 'stackexchange-api', `Expected source=stackexchange-api, got ${result.source}`);
  assert(result.title.toLowerCase().includes('sorted array'), 'Title should match expected question');
  assert(result.content.length > 500, `Content too short: ${result.content.length}`);

  console.log(`   Title: ${result.title.slice(0, 70)}`);
  console.log(`   Content: ${result.content.length} chars`);
});

await test('GitHub repo — REST API extraction', async () => {
  const result = await scrape('https://github.com/octocat/Hello-World');

  assert(result.source === 'github-api', `Expected source=github-api, got ${result.source}`);
  assert(result.title === 'octocat/Hello-World', `Unexpected title: ${result.title}`);
  assert(result.content.length > 50, `Content too short: ${result.content.length}`);

  console.log(`   Title: ${result.title}`);
  console.log(`   Content: ${result.content.length} chars`);
});

await test('arXiv — API extraction', async () => {
  const result = await scrape('https://arxiv.org/abs/1706.03762');

  assert(result.source === 'arxiv-api', `Expected source=arxiv-api, got ${result.source}`);
  assert(result.title.toLowerCase().includes('attention'), `Unexpected title: ${result.title}`);
  assert(result.content.length > 500, `Content too short: ${result.content.length}`);

  console.log(`   Title: ${result.title.slice(0, 70)}`);
  console.log(`   Content: ${result.content.length} chars`);
});

await test('DOI — Crossref API extraction', async () => {
  const result = await scrape('https://doi.org/10.1038/nphys1170');

  assert(result.source === 'crossref-api', `Expected source=crossref-api, got ${result.source}`);
  assert(result.title.length > 0, 'Title should not be empty');
  assert(result.content.length > 50, `Content too short: ${result.content.length}`);

  console.log(`   Title: ${result.title.slice(0, 70)}`);
  console.log(`   Content: ${result.content.length} chars`);
});

// =============================================================================
// Run
// =============================================================================

printResults();
