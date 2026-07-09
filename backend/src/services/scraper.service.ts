import axios from 'axios';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { YoutubeTranscript } from 'youtube-transcript';
import logger from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export type ContentType =
  | 'article'
  | 'tweet'
  | 'video'
  | 'reddit'
  | 'generic'
  | 'github'
  | 'stackoverflow'
  | 'wikipedia'
  | 'hn';

export type ScrapedSource =
  | 'readability'
  | 'cheerio'
  | 'jina'
  | 'arxiv-api'
  | 'crossref-api'
  | 'github-api'
  | 'hackernews-api'
  | 'mediawiki-api'
  | 'reddit-json'
  | 'reddit-api'
  | 'stackexchange-api'
  | 'youtube-api'
  | 'youtube-transcript';

export interface ScrapedContent {
  title: string;
  content: string;
  description: string;
  contentType: ContentType;
  source: ScrapedSource;
  metadata: {
    ogImage?: string;
    author?: string;
    siteName?: string;
    favicon?: string;
  };
}

export type ScraperErrorCode =
  | 'UNSUPPORTED_SITE'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'EMPTY_CONTENT'
  | 'INVALID_URL'
  | 'NON_HTML';

export class ScraperError extends Error {
  code: ScraperErrorCode;
  statusCode: number;
  suggestion?: string;

  constructor(
    code: ScraperErrorCode,
    message: string,
    statusCode: number,
    suggestion?: string
  ) {
    super(message);
    this.name = 'ScraperError';
    this.code = code;
    this.statusCode = statusCode;
    this.suggestion = suggestion;
  }
}

// =============================================================================
// Constants
// =============================================================================

const FETCH_TIMEOUT_MS = 10_000;
const JINA_TIMEOUT_MS = 5_000;
const MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT_CHARS = 50_000;
const MIN_CONTENT_LENGTH = 50;
const USER_AGENT = 'Notable/2.0 (personal bookmark manager; contact@notable.app)';
const REDDIT_USER_AGENT = 'web:notable-bookmark:v2.0.0 (by /u/notable_app)';
const MAX_REDIRECTS = 5;
const WIKIPEDIA_HOST_RE = /(^|\.)wikipedia\.org$/;
const MEDIAWIKI_HOST_RE = /(^|\.)mediawiki\.org$/;
const STACK_EXCHANGE_HOST_RE = /(^|\.)stackexchange\.com$/;
const STACK_OVERFLOW_HOST_RE = /(^|\.)stackoverflow\.com$/;
const GITHUB_HOST_RE = /(^|\.)github\.com$/;
const HN_HOST_RE = /(^|\.)ycombinator\.com$/;
const ARXIV_HOST_RE = /(^|\.)arxiv\.org$/;
const DOI_HOST_RE = /(^|\.)doi\.org$/;

const STACK_EXCHANGE_SITE_BY_HOST: Record<string, string> = {
  'stackoverflow.com': 'stackoverflow',
  'superuser.com': 'superuser',
  'serverfault.com': 'serverfault',
  'askubuntu.com': 'askubuntu',
  'mathoverflow.net': 'mathoverflow',
};

// Patterns that indicate a bot-challenge / access-denied page, NOT real content.
// These catch Cloudflare, Akamai, Datadome, PerimeterX, and generic WAF pages.
const BOT_CHALLENGE_PATTERNS = [
  // Cloudflare
  'cf-browser-verification',
  'cf_chl_opt',
  'challenge-platform',
  'just a moment',
  'checking your browser',
  'ray id',
  'cloudflare',
  'enable javascript and cookies to continue',
  // Akamai
  'access denied',
  'reference #',
  'akamaighost',
  // Datadome
  'datadome',
  'captcha-delivery',
  // PerimeterX / HUMAN
  'perimeterx',
  'px-captcha',
  // Generic WAF / anti-bot
  'please verify you are a human',
  'please verify you are not a robot',
  'please wait for verification',
  'reddit - please wait for verification',
  'blocked by security',
  "you've been blocked by network security",
  'use your developer token',
  'target url returned error 403',
  'automated access',
  'bot detection',
  'please complete the security check',
  'attention required',
];

// Elements to strip in Cheerio fallback
const STRIP_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'nav',
  'footer',
  'header',
  'aside',
  '.sidebar',
  '.comments',
  '.comment',
  '.ad',
  '.advertisement',
  '.social-share',
  '.share-buttons',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
].join(', ');

// =============================================================================
// Content Validation — Bot-Challenge Detection
// =============================================================================

/**
 * Detect if extracted content is actually a bot-challenge or access-denied page.
 * These pages return valid HTML (200 OK) but contain Cloudflare challenges,
 * CAPTCHA prompts, or "Access Denied" messages instead of real content.
 *
 * Without this check, the scraper would save "Checking your browser..."
 * or "Access Denied" as the actual page content.
 */
function isBotChallengePage(html: string): boolean {
  const lower = html.toLowerCase();

  // Short pages with challenge keywords are almost certainly bot pages
  // (real content pages are rarely <2KB)
  const isShort = html.length < 2000;

  // Count how many challenge patterns match
  let matchCount = 0;
  for (const pattern of BOT_CHALLENGE_PATTERNS) {
    if (lower.includes(pattern)) {
      matchCount++;
    }
  }

  // High confidence: short page + multiple challenge patterns
  if (isShort && matchCount >= 2) return true;

  // Very high confidence: 3+ patterns regardless of length
  if (matchCount >= 3) return true;

  // Cloudflare-specific: the challenge script tag is a dead giveaway
  if (lower.includes('cf-browser-verification') || lower.includes('cf_chl_opt')) {
    return true;
  }

  return false;
}

/**
 * Validate that extracted content is real article/post content and not
 * a bot-challenge page or other garbage.
 */
function validateContent(
  result: Omit<ScrapedContent, 'metadata'> | null
): Omit<ScrapedContent, 'metadata'> | null {
  if (!result) return null;
  if (result.content.length < MIN_CONTENT_LENGTH) return null;

  // Check if the content looks like a bot-challenge page
  if (isBotChallengePage(result.content)) {
    logger.info('Content appears to be a bot-challenge page, discarding');
    return null;
  }

  return result;
}

// =============================================================================
// Text Helpers
// =============================================================================

function normalizeWhitespace(text: string): string {
  return text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function stripHtml(html: string): string {
  const $ = cheerio.load(html);
  $(STRIP_SELECTORS).remove();
  return normalizeWhitespace($.text());
}

function truncate(text: string, max = MAX_OUTPUT_CHARS): string {
  return normalizeWhitespace(text).slice(0, max);
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  return values.find((value) => value?.trim())?.trim() || '';
}

function hostnameOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
}

function parseJsonFromScript(html: string, selector: string): unknown | null {
  const $ = cheerio.load(html);
  const raw = $(selector).first().text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// =============================================================================
// Content Type Detection
// =============================================================================

const SITE_PATTERNS: Record<string, ContentType> = {
  'twitter.com': 'tweet',
  'x.com': 'tweet',
  'reddit.com': 'reddit',
  'old.reddit.com': 'reddit',
  'www.reddit.com': 'reddit',
  'youtube.com': 'video',
  'www.youtube.com': 'video',
  'youtu.be': 'video',
  'm.youtube.com': 'video',
  'linkedin.com': 'generic',
  'www.linkedin.com': 'generic',
};

/**
 * Detect content type from URL hostname.
 */
function detectContentType(url: string): ContentType {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Check exact match first, then with www prefix
    return SITE_PATTERNS[hostname] || SITE_PATTERNS[`www.${hostname}`] || 'article';
  } catch {
    return 'article';
  }
}

// =============================================================================
// HTTP Fetch
// =============================================================================

interface FetchResult {
  html: string;
  finalUrl: string;
  contentType: string;
}

/**
 * Fetch HTML from a URL with timeout, redirect handling, and Content-Type check.
 */
async function fetchHtml(url: string): Promise<FetchResult> {
  try {
    const response = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      maxContentLength: MAX_CONTENT_LENGTH,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      responseType: 'text',
      // Follow redirects and capture final URL
      validateStatus: (status) => status < 400,
    });

    const responseContentType = String(response.headers['content-type'] || '').toLowerCase();

    // Reject non-HTML responses
    if (
      !responseContentType.includes('text/html') &&
      !responseContentType.includes('application/xhtml')
    ) {
      throw new ScraperError(
        'NON_HTML',
        `URL points to a non-HTML resource (${responseContentType.split(';')[0]})`,
        422
      );
    }

    return {
      html: response.data as string,
      finalUrl: response.request?.res?.responseUrl || url,
      contentType: responseContentType,
    };
  } catch (err) {
    if (err instanceof ScraperError) throw err;

    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        throw new ScraperError(
          'TIMEOUT',
          'Page took too long to respond',
          504,
          'Try saving this page using the Chrome extension instead.'
        );
      }
      if (err.response) {
        const status = err.response.status;
        if (status === 403) {
          throw new ScraperError(
            'HTTP_ERROR',
            'Access denied (403 Forbidden)',
            502,
            'Try saving this page using the Chrome extension instead.'
          );
        }
        if (status === 404) {
          throw new ScraperError('HTTP_ERROR', 'Page not found (404)', 404);
        }
        throw new ScraperError(
          'HTTP_ERROR',
          `Server returned ${status}`,
          502,
          status >= 500 ? 'The site may be temporarily down. Try again later.' : undefined
        );
      }
    }

    throw new ScraperError(
      'HTTP_ERROR',
      `Failed to fetch URL: ${(err as Error).message}`,
      502,
      'Try saving this page using the Chrome extension instead.'
    );
  }
}

// =============================================================================
// Metadata Extraction
// =============================================================================

interface ExtractedMetadata {
  title: string;
  description: string;
  ogImage?: string;
  author?: string;
  siteName?: string;
  favicon?: string;
}

/**
 * Extract metadata from HTML using og: tags, meta tags, and fallbacks.
 */
function extractMetadata(html: string, url: string): ExtractedMetadata {
  const $ = cheerio.load(html);
  const baseUrl = new URL(url);

  // Helper to resolve relative URLs
  const resolveUrl = (href: string | undefined): string | undefined => {
    if (!href) return undefined;
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return undefined;
    }
  };

  // Title: og:title > <title> tag
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
  const htmlTitle = $('title').first().text()?.trim();
  const title = ogTitle || htmlTitle || '';

  // Description: og:description > meta description
  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
  const metaDesc = $('meta[name="description"]').attr('content')?.trim();
  const description = ogDesc || metaDesc || '';

  // Image
  const ogImage = resolveUrl($('meta[property="og:image"]').attr('content'));

  // Author
  const author =
    $('meta[name="author"]').attr('content')?.trim() ||
    $('meta[property="article:author"]').attr('content')?.trim();

  // Site name
  const siteName =
    $('meta[property="og:site_name"]').attr('content')?.trim();

  // Favicon
  const faviconHref =
    $('link[rel="icon"]').attr('href') ||
    $('link[rel="shortcut icon"]').attr('href') ||
    $('link[rel="apple-touch-icon"]').attr('href');
  const favicon = resolveUrl(faviconHref) || resolveUrl('/favicon.ico');

  return { title, description, ogImage, author, siteName, favicon };
}

// =============================================================================
// Readability Extraction (Primary)
// =============================================================================

/**
 * Extract content using Mozilla Readability.
 * Returns null if Readability can't parse the page (e.g., SPAs with empty body).
 */
function extractWithReadability(html: string, url: string): Omit<ScrapedContent, 'metadata'> | null {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < MIN_CONTENT_LENGTH) {
      return null;
    }

    return {
      title: article.title || '',
      content: article.textContent.trim().slice(0, MAX_OUTPUT_CHARS),
      description: article.excerpt || '',
      contentType: 'article',
      source: 'readability',
    };
  } catch (err) {
    logger.debug('Readability extraction failed:', (err as Error).message);
    return null;
  }
}

// =============================================================================
// Cheerio Extraction (Fallback)
// =============================================================================

/**
 * Extract content using Cheerio (strips noise elements, grabs largest text block).
 * Returns null if extracted text is too short.
 */
function extractWithCheerio(html: string, url: string): Omit<ScrapedContent, 'metadata'> | null {
  try {
    const $ = cheerio.load(html);

    // Strip noise elements
    $(STRIP_SELECTORS).remove();

    // Try content selectors in priority order
    const selectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '.article-body'];
    let text = '';

    for (const selector of selectors) {
      const el = $(selector);
      if (el.length) {
        text = el.text().trim();
        if (text.length >= MIN_CONTENT_LENGTH) break;
      }
    }

    // Last resort: body text
    if (text.length < MIN_CONTENT_LENGTH) {
      text = $('body').text().trim();
    }

    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    if (text.length < MIN_CONTENT_LENGTH) {
      return null;
    }

    const title = $('title').first().text()?.trim() || '';

    return {
      title,
      content: text.slice(0, MAX_OUTPUT_CHARS),
      description: text.slice(0, 200),
      contentType: 'article',
      source: 'cheerio',
    };
  } catch (err) {
    logger.debug('Cheerio extraction failed:', (err as Error).message);
    return null;
  }
}

// =============================================================================
// API Adapters
// =============================================================================

async function extractMediaWiki(url: string): Promise<ScrapedContent> {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const pageTitle = decodeURIComponent(parsed.pathname.replace(/^\/wiki\//, '')).replace(/_/g, ' ');

  if (!pageTitle || parsed.pathname === '/') {
    return extractGeneric(url);
  }

  const apiUrl = `https://${host}/w/api.php`;
  const response = await axios.get(apiUrl, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    params: {
      action: 'query',
      prop: 'extracts|pageimages|info',
      exintro: false,
      explaintext: true,
      redirects: true,
      pithumbsize: 800,
      inprop: 'url',
      titles: pageTitle,
      format: 'json',
      formatversion: 2,
    },
  });

  const page = response.data?.query?.pages?.[0];
  const content = String(page?.extract || '').trim();

  if (!page || page.missing || content.length < MIN_CONTENT_LENGTH) {
    throw new ScraperError('EMPTY_CONTENT', 'Could not fetch MediaWiki article content', 422);
  }

  return {
    title: page.title || pageTitle,
    content: truncate(content),
    description: content.slice(0, 200),
    contentType: 'article',
    source: 'mediawiki-api',
    metadata: {
      ogImage: page.thumbnail?.source,
      siteName: host.replace(/^([a-z-]+)\./, ''),
      favicon: `https://${host}/favicon.ico`,
    },
  };
}

function extractHackerNewsId(url: string): string | null {
  const parsed = new URL(url);
  if (parsed.searchParams.has('id')) return parsed.searchParams.get('id');
  const itemMatch = parsed.pathname.match(/\/item\/(\d+)/);
  return itemMatch?.[1] || null;
}

async function fetchHackerNewsItem(id: string): Promise<any | null> {
  const response = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
    timeout: FETCH_TIMEOUT_MS,
  });
  return response.data || null;
}

async function extractHackerNews(url: string): Promise<ScrapedContent> {
  const id = extractHackerNewsId(url);
  if (!id) return extractGeneric(url);

  const item = await fetchHackerNewsItem(id);
  if (!item) {
    throw new ScraperError('EMPTY_CONTENT', 'Could not fetch Hacker News item', 422);
  }

  const childIds = Array.isArray(item.kids) ? item.kids.slice(0, 10) : [];
  const comments = await Promise.all(
    childIds.map(async (childId: number) => {
      try {
        return await fetchHackerNewsItem(String(childId));
      } catch {
        return null;
      }
    })
  );

  const commentText = comments
    .filter(Boolean)
    .map((comment) => {
      const by = comment.by ? `Comment by ${comment.by}` : 'Comment';
      return `${by}:\n${stripHtml(String(comment.text || ''))}`;
    })
    .filter((text) => text.length > MIN_CONTENT_LENGTH)
    .join('\n\n');

  const storyText = stripHtml(String(item.text || ''));
  const linkedUrl = item.url ? `URL: ${item.url}` : '';
  const content = truncate([item.title, linkedUrl, storyText, commentText].filter(Boolean).join('\n\n'));

  if (content.length < MIN_CONTENT_LENGTH) {
    throw new ScraperError('EMPTY_CONTENT', 'Hacker News item has no text content', 422);
  }

  return {
    title: item.title || `Hacker News item ${id}`,
    content,
    description: firstNonEmpty(storyText, linkedUrl, item.title).slice(0, 200),
    contentType: 'article',
    source: 'hackernews-api',
    metadata: {
      author: item.by,
      siteName: 'Hacker News',
      favicon: 'https://news.ycombinator.com/favicon.ico',
    },
  };
}

function getStackExchangeSite(host: string): string | null {
  if (STACK_EXCHANGE_SITE_BY_HOST[host]) return STACK_EXCHANGE_SITE_BY_HOST[host];
  if (host.endsWith('.stackexchange.com')) return host.replace(/\.stackexchange\.com$/, '');
  return null;
}

function extractStackExchangeQuestionId(url: string): string | null {
  const match = new URL(url).pathname.match(/\/questions\/(\d+)/);
  return match?.[1] || null;
}

async function extractStackExchange(url: string): Promise<ScrapedContent> {
  const parsed = new URL(url);
  const host = hostnameOf(url);
  const site = getStackExchangeSite(host);
  const questionId = extractStackExchangeQuestionId(url);

  if (!site || !questionId) return extractGeneric(url);

  const response = await axios.get(`https://api.stackexchange.com/2.3/questions/${questionId}`, {
    timeout: FETCH_TIMEOUT_MS,
    params: {
      order: 'desc',
      sort: 'activity',
      site,
      filter: 'withbody',
    },
  });

  const question = response.data?.items?.[0];
  if (!question) {
    throw new ScraperError('EMPTY_CONTENT', 'Could not fetch Stack Exchange question', 422);
  }

  let answersText = '';
  try {
    const answers = await axios.get(`https://api.stackexchange.com/2.3/questions/${questionId}/answers`, {
      timeout: FETCH_TIMEOUT_MS,
      params: {
        order: 'desc',
        sort: 'votes',
        site,
        filter: 'withbody',
        pagesize: 3,
      },
    });

    answersText = (answers.data?.items || [])
      .map((answer: any, index: number) => `Answer ${index + 1}:\n${stripHtml(String(answer.body || ''))}`)
      .join('\n\n');
  } catch (err) {
    logger.debug('Stack Exchange answers fetch failed:', (err as Error).message);
  }

  const questionBody = stripHtml(String(question.body || ''));
  const content = truncate([question.title, `Question:\n${questionBody}`, answersText].filter(Boolean).join('\n\n'));

  return {
    title: stripHtml(String(question.title || `Stack Exchange question ${questionId}`)),
    content,
    description: questionBody.slice(0, 200),
    contentType: 'article',
    source: 'stackexchange-api',
    metadata: {
      author: question.owner?.display_name,
      siteName: parsed.hostname,
      favicon: `https://${parsed.hostname}/favicon.ico`,
    },
  };
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (process.env.GITHUB_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_API_TOKEN}`;
  }

  return headers;
}

function extractGithubParts(url: string): { owner: string; repo: string; kind: 'repo' | 'issue' | 'pull'; number?: string } | null {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const [owner, repo, section, number] = parts;
  if ((section === 'issues' || section === 'pull') && number) {
    return { owner, repo, kind: section === 'pull' ? 'pull' : 'issue', number };
  }

  return { owner, repo, kind: 'repo' };
}

async function extractGithub(url: string): Promise<ScrapedContent> {
  const parts = extractGithubParts(url);
  if (!parts) return extractGeneric(url);

  if (parts.kind === 'repo') {
    const repo = await axios.get(`https://api.github.com/repos/${parts.owner}/${parts.repo}`, {
      timeout: FETCH_TIMEOUT_MS,
      headers: githubHeaders(),
    });

    let readmeText = '';
    try {
      const readme = await axios.get(`https://api.github.com/repos/${parts.owner}/${parts.repo}/readme`, {
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          ...githubHeaders(),
          Accept: 'application/vnd.github.raw',
        },
        responseType: 'text',
      });
      readmeText = String(readme.data || '');
    } catch (err) {
      logger.debug('GitHub README fetch failed:', (err as Error).message);
    }

    const data = repo.data;
    const content = truncate([
      data.full_name,
      data.description,
      data.homepage ? `Homepage: ${data.homepage}` : '',
      data.language ? `Language: ${data.language}` : '',
      Array.isArray(data.topics) && data.topics.length ? `Topics: ${data.topics.join(', ')}` : '',
      readmeText,
    ].filter(Boolean).join('\n\n'));

    return {
      title: data.full_name || `${parts.owner}/${parts.repo}`,
      content,
      description: firstNonEmpty(data.description, readmeText).slice(0, 200),
      contentType: 'article',
      source: 'github-api',
      metadata: {
        author: data.owner?.login,
        siteName: 'GitHub',
        ogImage: data.owner?.avatar_url,
        favicon: 'https://github.githubassets.com/favicons/favicon.svg',
      },
    };
  }

  const endpoint = parts.kind === 'pull' ? 'pulls' : 'issues';
  const response = await axios.get(
    `https://api.github.com/repos/${parts.owner}/${parts.repo}/${endpoint}/${parts.number}`,
    {
      timeout: FETCH_TIMEOUT_MS,
      headers: githubHeaders(),
    }
  );

  const data = response.data;
  const content = truncate([
    data.title,
    `State: ${data.state}`,
    data.user?.login ? `Author: ${data.user.login}` : '',
    data.body || '',
  ].filter(Boolean).join('\n\n'));

  return {
    title: data.title || `${parts.owner}/${parts.repo} #${parts.number}`,
    content,
    description: firstNonEmpty(data.body, data.title).slice(0, 200),
    contentType: 'article',
    source: 'github-api',
    metadata: {
      author: data.user?.login,
      siteName: 'GitHub',
      ogImage: data.user?.avatar_url,
      favicon: 'https://github.githubassets.com/favicons/favicon.svg',
    },
  };
}

function extractArxivId(url: string): string | null {
  const match = new URL(url).pathname.match(/^\/(?:abs|pdf|html)\/([^/?#]+)(?:\.pdf)?/);
  return match?.[1] || null;
}

async function extractArxiv(url: string): Promise<ScrapedContent> {
  const id = extractArxivId(url);
  if (!id) return extractGeneric(url);

  const response = await axios.get('https://export.arxiv.org/api/query', {
    timeout: FETCH_TIMEOUT_MS,
    responseType: 'text',
    params: { id_list: id },
  });

  const dom = new JSDOM(String(response.data), { contentType: 'text/xml' });
  const entry = dom.window.document.querySelector('entry');

  if (!entry) {
    throw new ScraperError('EMPTY_CONTENT', 'Could not fetch arXiv paper metadata', 422);
  }

  const text = (selector: string): string => entry.querySelector(selector)?.textContent?.trim() || '';
  const authors = Array.from(entry.querySelectorAll('author name')).map((node) => node.textContent?.trim()).filter(Boolean);
  const title = normalizeWhitespace(text('title'));
  const summary = normalizeWhitespace(text('summary'));
  const categories = Array.from(entry.querySelectorAll('category')).map((node) => node.getAttribute('term')).filter(Boolean);

  return {
    title,
    content: truncate([
      title,
      authors.length ? `Authors: ${authors.join(', ')}` : '',
      categories.length ? `Categories: ${categories.join(', ')}` : '',
      `Abstract:\n${summary}`,
    ].filter(Boolean).join('\n\n')),
    description: summary.slice(0, 200),
    contentType: 'article',
    source: 'arxiv-api',
    metadata: {
      author: authors.join(', '),
      siteName: 'arXiv',
      favicon: 'https://arxiv.org/favicon.ico',
    },
  };
}

function extractDoi(url: string): string | null {
  const parsed = new URL(url);
  if (DOI_HOST_RE.test(parsed.hostname)) {
    return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  }
  return null;
}

async function extractCrossref(url: string): Promise<ScrapedContent> {
  const doi = extractDoi(url);
  if (!doi) return extractGeneric(url);

  const response = await axios.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
  });

  const item = response.data?.message;
  if (!item) {
    throw new ScraperError('EMPTY_CONTENT', 'Could not fetch DOI metadata from Crossref', 422);
  }

  const title = Array.isArray(item.title) ? item.title[0] : item.title;
  const abstract = item.abstract ? stripHtml(String(item.abstract)) : '';
  const authors = Array.isArray(item.author)
    ? item.author.map((author: any) => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean)
    : [];
  const container = Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title'];

  const content = truncate([
    title,
    authors.length ? `Authors: ${authors.join(', ')}` : '',
    container ? `Published in: ${container}` : '',
    item.published?.['date-parts']?.[0] ? `Published: ${item.published['date-parts'][0].join('-')}` : '',
    abstract ? `Abstract:\n${abstract}` : '',
    item.URL ? `URL: ${item.URL}` : '',
  ].filter(Boolean).join('\n\n'));

  return {
    title: title || doi,
    content,
    description: firstNonEmpty(abstract, container, doi).slice(0, 200),
    contentType: 'article',
    source: 'crossref-api',
    metadata: {
      author: authors.join(', '),
      siteName: 'Crossref',
      favicon: 'https://www.crossref.org/favicon.ico',
    },
  };
}

function extractRedditArticle(url: string): { subreddit: string; article: string } | null {
  const match = new URL(url).pathname.match(/\/r\/([^/]+)\/comments\/([^/]+)/);
  if (!match) return null;
  return { subreddit: match[1], article: match[2] };
}

async function getRedditAccessToken(): Promise<string | null> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  try {
    const response = await axios.post(
      'https://www.reddit.com/api/v1/access_token',
      new URLSearchParams({ grant_type: 'client_credentials' }),
      {
        timeout: FETCH_TIMEOUT_MS,
        auth: { username: clientId, password: clientSecret },
        headers: {
          'User-Agent': REDDIT_USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return response.data?.access_token || null;
  } catch (err) {
    logger.debug('Reddit OAuth token fetch failed:', (err as Error).message);
    return null;
  }
}

async function extractRedditApi(url: string): Promise<ScrapedContent | null> {
  const article = extractRedditArticle(url);
  if (!article) return null;

  const token = await getRedditAccessToken();
  if (!token) return null;

  const response = await axios.get(
    `https://oauth.reddit.com/r/${article.subreddit}/comments/${article.article}`,
    {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': REDDIT_USER_AGENT,
      },
      params: { raw_json: 1 },
    }
  );

  const postData = response.data?.[0]?.data?.children?.[0]?.data;
  if (!postData) return null;

  const content = firstNonEmpty(postData.selftext, postData.title);

  return {
    title: postData.title || `Reddit post ${article.article}`,
    content: truncate([postData.title, postData.selftext].filter(Boolean).join('\n\n')),
    description: content.slice(0, 200),
    contentType: 'reddit',
    source: 'reddit-api',
    metadata: {
      siteName: 'Reddit',
      ogImage: postData.thumbnail && postData.thumbnail !== 'self' ? postData.thumbnail : undefined,
      author: postData.author ? `u/${postData.author}` : undefined,
      favicon: 'https://www.redditstatic.com/desktop2x/img/favicon/favicon-32x32.png',
    },
  };
}

// =============================================================================
// Reddit Extraction (Dedicated .json API)
// =============================================================================

/**
 * Extract Reddit post content via the .json API.
 * Works reliably for public posts without needing to parse HTML.
 */
async function extractReddit(url: string): Promise<ScrapedContent> {
  const apiResult = await extractRedditApi(url);
  if (apiResult) return apiResult;

  try {
    // Normalize URL: strip trailing slash, append .json
    let jsonUrl = url.replace(/\/$/, '');
    if (!jsonUrl.endsWith('.json')) {
      jsonUrl += '.json';
    }

    const response = await axios.get(jsonUrl, {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        // Reddit requires a unique, descriptive User-Agent.
        // Default or generic UAs (axios, python-requests) get instant 403.
        // Unauthenticated limit: 10 req/min/IP.
        'User-Agent': REDDIT_USER_AGENT,
        'Accept': 'application/json',
      },
    });

    const data = response.data;

    // Reddit returns an array: [post, comments]
    const postData = data?.[0]?.data?.children?.[0]?.data;

    if (!postData) {
      throw new ScraperError(
        'EMPTY_CONTENT',
        'Could not parse Reddit post data',
        422,
        'Try saving this page using the Chrome extension instead.'
      );
    }

    const title = postData.title || '';
    let content = '';

    // Handle different post types
    if (postData.selftext) {
      // Text post
      content = postData.selftext;
    } else if (postData.crosspost_parent_list?.[0]?.selftext) {
      // Crosspost with text
      content = postData.crosspost_parent_list[0].selftext;
    } else if (postData.url && postData.url !== url) {
      // Link post — include the linked URL
      content = `Link post: ${postData.url}`;
    }

    if (!content && !title) {
      throw new ScraperError(
        'EMPTY_CONTENT',
        'Reddit post has no text content',
        422,
        'This may be an image/video post. Try the Chrome extension to capture visible content.'
      );
    }

    // Build description from first ~200 chars
    const description = (content || title).slice(0, 200);

    return {
      title,
      content: `${title}\n\n${content}`.trim().slice(0, MAX_OUTPUT_CHARS),
      description,
      contentType: 'reddit',
      source: 'reddit-json',
      metadata: {
        siteName: 'Reddit',
        ogImage: postData.thumbnail && postData.thumbnail !== 'self' ? postData.thumbnail : undefined,
        author: postData.author ? `u/${postData.author}` : undefined,
      },
    };
  } catch (err) {
    if (err instanceof ScraperError && err.code === 'EMPTY_CONTENT') throw err;

    // Reddit .json API may return 403 — fall back to generic HTML extraction
    logger.info(`Reddit .json failed for ${url}, falling back to HTML extraction...`);
    try {
      const result = await extractGeneric(url);
      return { ...result, contentType: 'reddit' };
    } catch {
      throw new ScraperError(
        'HTTP_ERROR',
        `Failed to fetch Reddit post: ${(err as Error).message}`,
        502,
        'Try saving this page using the Chrome extension instead.'
      );
    }
  }
}

// =============================================================================
// YouTube Extraction (Dedicated — youtube-transcript package)
// =============================================================================

/**
 * Extract video ID from various YouTube URL formats.
 */
function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');

    if (hostname === 'youtu.be') {
      return parsed.pathname.slice(1) || null;
    }

    if (hostname === 'youtube.com') {
      // /watch?v=VIDEO_ID
      if (parsed.searchParams.has('v')) {
        return parsed.searchParams.get('v');
      }
      // /shorts/VIDEO_ID or /embed/VIDEO_ID
      const pathMatch = parsed.pathname.match(/^\/(shorts|embed)\/([^/?]+)/);
      if (pathMatch) {
        return pathMatch[2];
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchYouTubeApiMetadata(videoId: string): Promise<ExtractedMetadata | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      timeout: FETCH_TIMEOUT_MS,
      params: {
        key: apiKey,
        id: videoId,
        part: 'snippet',
      },
    });

    const snippet = response.data?.items?.[0]?.snippet;
    if (!snippet) return null;

    return {
      title: snippet.title || '',
      description: snippet.description || '',
      ogImage:
        snippet.thumbnails?.maxres?.url ||
        snippet.thumbnails?.standard?.url ||
        snippet.thumbnails?.high?.url ||
        snippet.thumbnails?.default?.url,
      author: snippet.channelTitle,
      siteName: 'YouTube',
      favicon: 'https://www.youtube.com/favicon.ico',
    };
  } catch (err) {
    logger.debug('YouTube Data API metadata fetch failed:', (err as Error).message);
    return null;
  }
}

/**
 * Extract YouTube video content: transcript (capped at ~5 min) + metadata.
 */
async function extractYouTube(url: string): Promise<ScrapedContent> {
  const videoId = extractYouTubeVideoId(url);

  if (!videoId) {
    throw new ScraperError(
      'INVALID_URL',
      'Could not extract YouTube video ID from URL',
      400
    );
  }

  let transcriptText = '';
  let metadataFromHtml: ExtractedMetadata = { title: '', description: '' };

  // Try to get transcript
  // NOTE: youtube-transcript relies on undocumented YouTube internal APIs.
  // It may break when YouTube updates its frontend. It also fails silently on:
  //   - Age-restricted videos (require login)
  //   - Videos with transcripts disabled by creator
  //   - Private/unlisted videos
  // In all these cases, we gracefully fall back to the video description.
  try {
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);

    // Cap at ~5 minutes (roughly first 50-60 segments)
    const cappedItems = transcriptItems.slice(0, 60);
    transcriptText = cappedItems.map((item) => item.text).join(' ');
  } catch (err) {
    const errMsg = (err as Error).message || '';
    if (errMsg.includes('disabled') || errMsg.includes('Transcript is disabled')) {
      logger.info(`Transcript disabled by creator for ${videoId}, using description`);
    } else if (errMsg.includes('age') || errMsg.includes('restricted') || errMsg.includes('login')) {
      logger.info(`Age-restricted video ${videoId}, transcript unavailable without auth`);
    } else {
      // Likely a youtube-transcript package breakage or network issue
      logger.warn(`YouTube transcript fetch failed for ${videoId} (may be a package issue):`, errMsg);
    }
    // All cases: fall back to description
  }

  const metadataFromApi = await fetchYouTubeApiMetadata(videoId);
  if (metadataFromApi) {
    metadataFromHtml = metadataFromApi;
  } else {
    // Fetch page HTML for title + description + metadata
    try {
      const { html, finalUrl } = await fetchHtml(`https://www.youtube.com/watch?v=${videoId}`);
      metadataFromHtml = extractMetadata(html, finalUrl);
    } catch (err) {
      logger.debug('Failed to fetch YouTube page metadata:', (err as Error).message);
    }
  }

  const title = metadataFromHtml.title || `YouTube Video ${videoId}`;
  const description = metadataFromHtml.description || '';

  // Build content: transcript if available, else description
  let content = '';
  if (transcriptText) {
    content = `${title}\n\n${description}\n\nTranscript:\n${transcriptText}`;
  } else if (description) {
    content = `${title}\n\n${description}`;
  } else {
    throw new ScraperError(
      'EMPTY_CONTENT',
      'No transcript or description available for this video',
      422,
      'Try saving this page using the Chrome extension to capture visible content.'
    );
  }

  return {
    title,
    content: content.trim().slice(0, MAX_OUTPUT_CHARS),
    description: description.slice(0, 200) || title,
    contentType: 'video',
    source: metadataFromApi ? 'youtube-api' : 'youtube-transcript',
    metadata: {
      ogImage: metadataFromHtml.ogImage,
      author: metadataFromHtml.author,
      siteName: 'YouTube',
      favicon: 'https://www.youtube.com/favicon.ico',
    },
  };
}

// =============================================================================
// Jina Reader (Last resort fallback — free tier, no API key)
// =============================================================================

/**
 * Extract content using Jina Reader (r.jina.ai).
 * Used only when local extraction (Readability + Cheerio) returns nothing,
 * which usually means the page is a JS-rendered SPA.
 *
 * Free tier: 20 RPM, no API key needed.
 * NEVER throws — returns null on any failure.
 */
async function extractWithJina(url: string): Promise<Omit<ScrapedContent, 'metadata'> | null> {
  try {
    const response = await axios.get(`https://r.jina.ai/${url}`, {
      timeout: JINA_TIMEOUT_MS,
      headers: {
        'Accept': 'text/plain',
        'User-Agent': USER_AGENT,
      },
      responseType: 'text',
    });

    const text = (response.data as string || '').trim();

    if (text.length < MIN_CONTENT_LENGTH) {
      return null;
    }

    // Try to extract title from first markdown heading
    const titleMatch = text.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() || '';

    return {
      title,
      content: text.slice(0, MAX_OUTPUT_CHARS),
      description: text.slice(0, 200),
      contentType: 'article',
      source: 'jina',
    };
  } catch (err) {
    // Jina is best-effort — never block the pipeline
    logger.debug('Jina Reader fallback failed (non-blocking):', (err as Error).message);
    return null;
  }
}

// =============================================================================
// Generic Extraction Pipeline (Local → Jina → Suggest Extension)
// =============================================================================

/**
 * Extract content from a generic URL.
 * Pipeline: Local Readability → Cheerio → Jina → Suggest extension
 */
async function extractGeneric(url: string): Promise<ScrapedContent> {
  // Step 1: Fetch HTML locally
  const { html, finalUrl } = await fetchHtml(url);
  const meta = extractMetadata(html, finalUrl);

  const metadata = {
    ogImage: meta.ogImage,
    author: meta.author,
    siteName: meta.siteName,
    favicon: meta.favicon,
  };

  // Early check: if the raw HTML is a bot-challenge page, skip local
  // extraction entirely — Readability/Cheerio would just extract the
  // challenge text ("Checking your browser...") as real content.
  const isChallenged = isBotChallengePage(html);

  if (!isChallenged) {
    // Step 2: Try Readability (best quality)
    const readable = validateContent(extractWithReadability(html, finalUrl));
    if (readable) {
      return {
        ...readable,
        title: readable.title || meta.title,
        description: readable.description || meta.description,
        metadata,
      };
    }

    // Step 3: Try Cheerio (fallback)
    const cheerioResult = validateContent(extractWithCheerio(html, finalUrl));
    if (cheerioResult) {
      return {
        ...cheerioResult,
        title: cheerioResult.title || meta.title,
        description: cheerioResult.description || meta.description,
        metadata,
      };
    }
  } else {
    logger.info(`Bot-challenge page detected for ${finalUrl}, skipping local extraction`);
  }

  // Step 4: Local failed — try Jina (likely a SPA)
  logger.info(`Local extraction got nothing for ${finalUrl}, trying Jina Reader...`);
  const jinaResult = validateContent(await extractWithJina(url));
  if (jinaResult && jinaResult.content.length >= MIN_CONTENT_LENGTH) {
    return {
      ...jinaResult,
      title: jinaResult.title || meta.title,
      description: jinaResult.description || meta.description,
      metadata,
    };
  }

  // Step 5: Nothing worked — suggest extension
  throw new ScraperError(
    'EMPTY_CONTENT',
    'Could not extract meaningful content from this page.',
    422,
    'Try saving this page using the Chrome extension instead.'
  );
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Scrape a URL and return extracted content.
 *
 * Routing:
 *   - Twitter/LinkedIn → error with extension suggestion
 *   - Reddit → .json API
 *   - YouTube → transcript package
 *   - Everything else → Local (Readability → Cheerio) → Jina → suggest extension
 */
export async function scrape(url: string): Promise<ScrapedContent> {
  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ScraperError('INVALID_URL', 'Invalid URL format', 400);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ScraperError('INVALID_URL', 'Only HTTP and HTTPS URLs are supported', 400);
  }

  const contentType = detectContentType(url);
  const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();

  if (WIKIPEDIA_HOST_RE.test(parsedUrl.hostname) || MEDIAWIKI_HOST_RE.test(parsedUrl.hostname)) {
    return extractMediaWiki(url);
  }

  if (HN_HOST_RE.test(parsedUrl.hostname)) {
    return extractHackerNews(url);
  }

  if (STACK_OVERFLOW_HOST_RE.test(parsedUrl.hostname) || STACK_EXCHANGE_HOST_RE.test(parsedUrl.hostname)) {
    return extractStackExchange(url);
  }

  if (GITHUB_HOST_RE.test(parsedUrl.hostname)) {
    return extractGithub(url);
  }

  if (ARXIV_HOST_RE.test(parsedUrl.hostname)) {
    return extractArxiv(url);
  }

  if (DOI_HOST_RE.test(parsedUrl.hostname)) {
    return extractCrossref(url);
  }

  switch (contentType) {
    case 'tweet':
      throw new ScraperError(
        'UNSUPPORTED_SITE',
        'Twitter/X cannot be scraped server-side.',
        422,
        'Use the Chrome extension to save tweets.'
      );

    case 'reddit':
      return extractReddit(url);

    case 'video':
      return extractYouTube(url);

    case 'generic': {
      // LinkedIn — same as unsupported
      if (hostname === 'linkedin.com') {
        throw new ScraperError(
          'UNSUPPORTED_SITE',
          'LinkedIn cannot be scraped server-side.',
          422,
          'Use the Chrome extension to save LinkedIn posts.'
        );
      }
      return extractGeneric(url);
    }

    case 'article':
    default:
      return extractGeneric(url);
  }
}

export default { scrape };
