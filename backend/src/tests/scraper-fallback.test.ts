/**
 * Scraper fallback tests with mocked HTTP responses.
 *
 * Run: npx tsx src/tests/scraper-fallback.test.ts
 */
import axios from 'axios';
import { scrape, ScraperError } from '../services/scraper.service.js';

interface TestResult {
  label: string;
  passed: boolean;
  duration: number;
  error?: string;
}

type MockResponse = {
  data: unknown;
  headers?: Record<string, string>;
  finalUrl?: string;
};

type MockHandler = (url: string, config?: unknown) => MockResponse | Promise<MockResponse>;

const results: TestResult[] = [];
const originalGet = axios.get;

async function test(label: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ label, passed: true, duration: Date.now() - start });
  } catch (err) {
    results.push({
      label,
      passed: false,
      duration: Date.now() - start,
      error: (err as Error).message,
    });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function htmlResponse(html: string, finalUrl = 'https://example.test/page'): MockResponse {
  return {
    data: html,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    finalUrl,
  };
}

function textResponse(text: string): MockResponse {
  return {
    data: text,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  };
}

async function withMockedGet(handler: MockHandler, fn: () => Promise<void>): Promise<void> {
  (axios as any).get = async (url: string, config?: unknown) => {
    const response = await handler(url, config);
    return {
      data: response.data,
      headers: response.headers || {},
      request: {
        res: {
          responseUrl: response.finalUrl || url,
        },
      },
    };
  };

  try {
    await fn();
  } finally {
    (axios as any).get = originalGet;
  }
}

async function expectScraperError(
  fn: () => Promise<unknown>,
  code: ScraperError['code']
): Promise<ScraperError> {
  try {
    await fn();
    throw new Error('Expected scrape to throw');
  } catch (err) {
    assert(err instanceof ScraperError, 'Expected ScraperError');
    assert((err as ScraperError).code === code, `Expected ${code}, got ${(err as ScraperError).code}`);
    return err as ScraperError;
  }
}

function printResults(): void {
  console.log('\n' + '='.repeat(70));
  console.log('SCRAPER FALLBACK TEST RESULTS');
  console.log('='.repeat(70) + '\n');

  for (const r of results) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    console.log(`${icon} ${r.label} (${r.duration}ms)`);
    if (r.error) console.log(`   Error: ${r.error}`);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log('\n' + '='.repeat(70));
  console.log(`${passed} passed, ${failed} failed out of ${results.length} tests`);
  console.log('='.repeat(70));

  if (failed > 0) process.exitCode = 1;
}

await test('Readability extracts normal article HTML', async () => {
  await withMockedGet(
    async () =>
      htmlResponse(`
        <!doctype html>
        <html>
          <head>
            <title>Readable Test Article</title>
            <meta name="description" content="A readable article for tests">
          </head>
          <body>
            <article>
              <h1>Readable Test Article</h1>
              <p>This article has enough original content to pass the minimum length check.</p>
              <p>It should be handled locally without calling the remote fallback reader.</p>
              <p>The scraper should return clean text and preserve the title.</p>
            </article>
          </body>
        </html>
      `),
    async () => {
      const result = await scrape('https://example.test/readable');

      assert(result.source === 'readability', `Expected readability, got ${result.source}`);
      assert(result.title.includes('Readable Test Article'), 'Expected article title');
      assert(result.content.includes('enough original content'), 'Expected article body');
    }
  );
});

await test('Empty SPA page falls back to Jina content', async () => {
  await withMockedGet(
    async (url) => {
      if (url.startsWith('https://r.jina.ai/')) {
        return textResponse(`# Rendered SPA Article

This content came from the fallback reader after the local HTML had no useful body text.
It is long enough to pass validation and should become the saved article text.`);
      }

      return htmlResponse(`
        <!doctype html>
        <html>
          <head><title>Client App</title></head>
          <body><div id="root"></div><script src="/app.js"></script></body>
        </html>
      `);
    },
    async () => {
      const result = await scrape('https://example.test/spa');

      assert(result.source === 'jina', `Expected jina, got ${result.source}`);
      assert(result.title === 'Rendered SPA Article', `Unexpected title: ${result.title}`);
      assert(result.content.includes('fallback reader'), 'Expected Jina fallback content');
    }
  );
});

await test('Cloudflare-style local page skips local extraction and uses Jina fallback', async () => {
  await withMockedGet(
    async (url) => {
      if (url.startsWith('https://r.jina.ai/')) {
        return textResponse(`# Real Article Behind Challenge

The local fetch saw a security challenge, but the fallback reader returned meaningful article content.
This verifies that challenge pages do not get saved as memories.`);
      }

      return htmlResponse(`
        <!doctype html>
        <html>
          <head><title>Just a moment...</title><script>window._cf_chl_opt = {}</script></head>
          <body>Checking your browser before accessing this site. Cloudflare Ray ID: test.</body>
        </html>
      `);
    },
    async () => {
      const result = await scrape('https://example.test/challenge');

      assert(result.source === 'jina', `Expected jina, got ${result.source}`);
      assert(result.title === 'Real Article Behind Challenge', `Unexpected title: ${result.title}`);
      assert(!result.content.toLowerCase().includes('checking your browser'), 'Challenge text should not be saved');
    }
  );
});

await test('Cloudflare local page plus blocked Jina output returns extension fallback error', async () => {
  await withMockedGet(
    async (url) => {
      if (url.startsWith('https://r.jina.ai/')) {
        return textResponse(`# Reddit - Please wait for verification

Warning: Target URL returned error 403: Forbidden

You've been blocked by network security.
To continue, log in to your Reddit account or use your developer token.`);
      }

      return htmlResponse(`
        <!doctype html>
        <html>
          <head><title>Just a moment...</title><script>window._cf_chl_opt = {}</script></head>
          <body>Checking your browser. Cloudflare challenge-platform page.</body>
        </html>
      `);
    },
    async () => {
      const err = await expectScraperError(
        () => scrape('https://example.test/blocked-everywhere'),
        'EMPTY_CONTENT'
      );

      assert(Boolean(err.suggestion?.includes('Chrome extension')), 'Expected Chrome extension suggestion');
    }
  );
});

await test('HTTP 403 returns HTTP_ERROR with extension suggestion', async () => {
  await withMockedGet(
    async () => {
      const err = new Error('Request failed with status code 403') as any;
      err.isAxiosError = true;
      err.response = { status: 403 };
      throw err;
    },
    async () => {
      const err = await expectScraperError(() => scrape('https://example.test/forbidden'), 'HTTP_ERROR');

      assert(err.statusCode === 502, `Expected status 502, got ${err.statusCode}`);
      assert(Boolean(err.suggestion?.includes('Chrome extension')), 'Expected Chrome extension suggestion');
    }
  );
});

await test('Non-HTML response returns NON_HTML instead of scraping garbage', async () => {
  await withMockedGet(
    async () => ({
      data: '%PDF-1.7 fake binary',
      headers: { 'content-type': 'application/pdf' },
    }),
    async () => {
      const err = await expectScraperError(() => scrape('https://example.test/file.pdf'), 'NON_HTML');

      assert(err.statusCode === 422, `Expected status 422, got ${err.statusCode}`);
    }
  );
});

printResults();
