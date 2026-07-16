// =============================================================================
// Content Extraction — site-specific and generic fallback
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

export interface ExtractedContent {
  content: string;
  contentType: ContentType;
  title: string;
  description: string;
  metadata: {
    ogImage?: string;
    author?: string;
    siteName?: string;
    favicon?: string;
  };
}

const MAX_CONTENT_LENGTH = 10_000;

// =============================================================================
// Site detection from URL hostname
// =============================================================================

const SITE_PATTERNS: Record<string, ContentType> = {
  'twitter.com': 'tweet',
  'x.com': 'tweet',
  'reddit.com': 'reddit',
  'old.reddit.com': 'reddit',
  'youtube.com': 'video',
  'youtu.be': 'video',
  'github.com': 'github',
  'stackoverflow.com': 'stackoverflow',
  'stackexchange.com': 'stackoverflow',
  'wikipedia.org': 'wikipedia',
  'en.wikipedia.org': 'wikipedia',
  'news.ycombinator.com': 'hn',
  'linkedin.com': 'generic',
};

export function detectContentType(url: string): ContentType {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Check exact match, then partial (e.g., "en.wikipedia.org" matches "wikipedia.org")
    if (SITE_PATTERNS[hostname]) return SITE_PATTERNS[hostname];
    for (const [pattern, type] of Object.entries(SITE_PATTERNS)) {
      if (hostname.endsWith(pattern)) return type;
    }
    return 'article';
  } catch {
    return 'article';
  }
}

// =============================================================================
// Site-specific selectors
// =============================================================================

interface SiteSelector {
  contentSelectors: string[];
  removeSelectors?: string[];
}

const SITE_SELECTORS: Partial<Record<ContentType, SiteSelector>> = {
  tweet: {
    contentSelectors: [
      '[data-testid="tweetText"]',
      '[data-testid="tweet"]',
      'article[role="article"]',
    ],
    removeSelectors: [
      '[data-testid="like"]',
      '[data-testid="retweet"]',
      '[data-testid="reply"]',
      '[role="group"]',
    ],
  },
  reddit: {
    contentSelectors: [
      '[data-test-id="post-content"]',
      '.Post__content',
      'shreddit-post',
      '.thing .usertext-body',
    ],
    removeSelectors: [
      '.Comment',
      '[data-testid="comment"]',
      '.side',
      '.footer',
    ],
  },
  video: {
    contentSelectors: [
      '#description-inline-expander',
      'ytd-text-inline-expander',
      '#info-contents',
      '#description',
    ],
  },
  github: {
    contentSelectors: [
      '#readme',
      '.markdown-body',
      '.repository-content',
    ],
  },
  stackoverflow: {
    contentSelectors: [
      '.question .js-post-body',
      '.accepted-answer .js-post-body',
      '#question .postcell',
    ],
    removeSelectors: [
      '.js-vote-count',
      '.post-menu',
      '.comments',
    ],
  },
  wikipedia: {
    contentSelectors: [
      '#mw-content-text .mw-parser-output',
      '#bodyContent',
    ],
    removeSelectors: [
      '.reflist',
      '.navbox',
      '.mw-jump-link',
      '#toc',
      '.infobox',
    ],
  },
};

// =============================================================================
// Metadata extraction
// =============================================================================

function extractMetadata(): ExtractedContent['metadata'] {
  const getMeta = (name: string): string | undefined => {
    const el =
      document.querySelector(`meta[property="${name}"]`) ||
      document.querySelector(`meta[name="${name}"]`);
    return el?.getAttribute('content') || undefined;
  };

  const favicon =
    (document.querySelector('link[rel="icon"]') as HTMLLinkElement)?.href ||
    (document.querySelector('link[rel="shortcut icon"]') as HTMLLinkElement)?.href ||
    undefined;

  return {
    ogImage: getMeta('og:image'),
    author: getMeta('author') || getMeta('article:author'),
    siteName: getMeta('og:site_name'),
    favicon,
  };
}

function extractTitle(): string {
  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  return ogTitle || document.title || '';
}

function extractDescription(): string {
  const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
  const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content');
  return ogDesc || metaDesc || '';
}

// =============================================================================
// Content extraction
// =============================================================================

function extractWithSelectors(selector: SiteSelector): string | null {
  // Remove unwanted elements first
  if (selector.removeSelectors) {
    for (const sel of selector.removeSelectors) {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    }
  }

  // Try each content selector
  for (const sel of selector.contentSelectors) {
    const elements = document.querySelectorAll(sel);
    if (elements.length > 0) {
      const texts = Array.from(elements).map((el) => (el as HTMLElement).innerText.trim());
      const combined = texts.join('\n\n');
      if (combined.length > 50) return combined;
    }
  }

  return null;
}

function extractGeneric(): string {
  // Strategy 1: Try <article> tag
  const article = document.querySelector('article');
  if (article && article.innerText.trim().length > 100) {
    return article.innerText.trim();
  }

  // Strategy 2: Try <main> tag
  const main = document.querySelector('main');
  if (main && main.innerText.trim().length > 100) {
    return main.innerText.trim();
  }

  // Strategy 3: Find the largest text-dense block
  const candidates = document.querySelectorAll('div, section');
  let bestBlock = '';
  let bestLength = 0;

  candidates.forEach((el) => {
    const text = (el as HTMLElement).innerText.trim();
    // Prefer blocks with high text-to-HTML ratio (text dense)
    const ratio = text.length / ((el as HTMLElement).innerHTML.length || 1);
    const score = text.length * ratio;
    if (score > bestLength && text.length > 100) {
      bestBlock = text;
      bestLength = score;
    }
  });

  if (bestBlock.length > 100) return bestBlock;

  // Strategy 4: Fallback to body text
  return document.body.innerText.trim();
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract content from the current page.
 * This function runs inside the content script context (has DOM access).
 */
export function extractPage(url: string): ExtractedContent {
  const contentType = detectContentType(url);
  const siteSelector = SITE_SELECTORS[contentType];

  let content: string;

  if (siteSelector) {
    content = extractWithSelectors(siteSelector) || extractGeneric();
  } else {
    content = extractGeneric();
  }

  // Truncate to max length
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH);
  }

  return {
    content,
    contentType,
    title: extractTitle(),
    description: extractDescription(),
    metadata: extractMetadata(),
  };
}
