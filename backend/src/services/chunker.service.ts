import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getEncoding } from 'js-tiktoken';
import type { ContentType } from './scraper.service.js';
import logger from '../utils/logger.js';

// =============================================================================
// Token counter — shared across all splitter instances
// =============================================================================

let _enc: ReturnType<typeof getEncoding> | null = null;

function getEncoder() {
  if (!_enc) {
    try {
      _enc = getEncoding('cl100k_base');
    } catch (err) {
      logger.warn('chunker: tiktoken failed to initialise, falling back to char/4', err);
    }
  }
  return _enc;
}

export function tokenLen(text: string): number {
  const enc = getEncoder();
  if (enc) {
    return enc.encode(text).length;
  }
  return Math.ceil(text.length / 4);
}

// =============================================================================
// Types
// =============================================================================

export interface Chunk {
  text: string;
  index: number;
}

// =============================================================================
// Splitter config constants
// =============================================================================

const CHUNK_SIZE = 500;   // target tokens per chunk
const CHUNK_OVERLAP = 50; // overlap tokens between adjacent chunks

// =============================================================================
// Bucket 2 — structured content (markdown headers)
// =============================================================================

/**
 * Uses MarkdownTextSplitter for header-aware splitting, then
 * RecursiveCharacterTextSplitter for any section still > CHUNK_SIZE tokens.
 * Prepends the nearest header to every chunk so embeddings are topic-anchored.
 *
 * Note: `@langchain/textsplitters` only exports `MarkdownTextSplitter`
 * (RecursiveCharacterTextSplitter with markdown separators), not the
 * `MarkdownHeaderTextSplitter` class. Since `MarkdownTextSplitter` doesn't
 * set header metadata, we extract the nearest heading from each doc's text
 * via regex and propagate it to sub-split chunks manually.
 */
async function splitByHeaders(text: string): Promise<Chunk[]> {
  // First pass: split on markdown headers
  const headerSplitter = new MarkdownTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    lengthFunction: tokenLen,
  });

  const headerDocs = await headerSplitter.createDocuments([text]);

  // Second pass: any doc still over limit gets paragraph-split further
  const paragraphSplitter = new RecursiveCharacterTextSplitter({
    separators: ['\n\n', '\n', ' '],
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    lengthFunction: tokenLen,
  });

  const finalChunks: string[] = [];

  for (const doc of headerDocs) {
    const content = doc.pageContent;
    // Extract the first markdown heading from the chunk text
    const headerMatch = content.match(/^(#{1,6}\s+.*)$/m);
    const header = headerMatch ? headerMatch[1].trim() : '';

    if (tokenLen(content) > CHUNK_SIZE) {
      const subDocs = await paragraphSplitter.createDocuments([content]);
      for (const sub of subDocs) {
        const subContent = sub.pageContent;
        const chunkText = (header && !subContent.startsWith(header))
          ? `${header}\n${subContent}`
          : subContent;
        finalChunks.push(chunkText);
      }
    } else {
      finalChunks.push(content);
    }
  }

  return finalChunks.map((t, i) => ({ text: t, index: i }));
}

// =============================================================================
// Bucket 3 — unstructured content (sentence boundaries)
// =============================================================================

async function splitBySentences(text: string): Promise<Chunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    separators: ['\n\n', '. ', '? ', '! ', '\n', ' '],
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    lengthFunction: tokenLen,
  });

  const docs = await splitter.createDocuments([text]);
  return docs.map((d, i) => ({ text: d.pageContent, index: i }));
}

// =============================================================================
// Public API
// =============================================================================

/** Content types that use the structured (header-aware) strategy */
const STRUCTURED_TYPES = new Set<ContentType>([
  'article',
  'reddit',
  'github',
  'stackoverflow',
  'wikipedia',
  'hn',
]);

/**
 * Split `text` into chunks using a content-type-aware strategy.
 *
 * - Short content (≤ 500 tokens): single chunk, no split
 * - Structured (article, reddit, github, stackoverflow, wikipedia, hn): header-aware split
 * - Unstructured (video, tweet, generic): sentence-boundary split
 */
export async function chunk(text: string, contentType: ContentType): Promise<Chunk[]> {
  // Bucket 1: short content — don't split
  if (tokenLen(text) <= CHUNK_SIZE) {
    logger.debug(`chunker: single-chunk (${tokenLen(text)} tokens), type=${contentType}`);
    return [{ text, index: 0 }];
  }

  if (STRUCTURED_TYPES.has(contentType)) {
    logger.debug(`chunker: structured split, type=${contentType}`);
    return splitByHeaders(text);
  }

  // Bucket 3: video, tweet (if long), generic
  logger.debug(`chunker: sentence split, type=${contentType}`);
  return splitBySentences(text);
}
