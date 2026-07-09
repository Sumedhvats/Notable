import axios, { AxiosError } from 'axios';
import logger from '../utils/logger.js';

// =============================================================================
// Config
// =============================================================================

const JINA_API_URL = 'https://api.jina.ai/v1/embeddings';
const JINA_MODEL = process.env.JINA_EMBEDDING_MODEL ?? 'jina-embeddings-v4';
const JINA_DIMENSIONS = parseInt(process.env.JINA_EMBEDDING_DIMENSIONS ?? '512', 10);
const JINA_BATCH_SIZE = 128;
const MAX_RETRIES = 3;

// =============================================================================
// Errors
// =============================================================================

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embed a single batch (≤ 128 texts) with exponential backoff on 429.
 */
async function embedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new EmbeddingError('JINA_API_KEY is not set');

  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      const response = await axios.post<{ data: { embedding: number[] }[] }>(
        JINA_API_URL,
        {
          input: texts,
          model: JINA_MODEL,
          dimensions: JINA_DIMENSIONS,
          task: 'retrieval.passage',
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        },
      );

      // Jina returns results in the same order as input
      return response.data.data.map((d) => d.embedding);
    } catch (err) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status;

      if (status === 429 && attempt < MAX_RETRIES) {
        // Exponential backoff with jitter: 1s, 2s, 4s (±20%)
        const base = Math.pow(2, attempt) * 1000;
        const jitter = base * 0.2 * (Math.random() * 2 - 1);
        const delay = Math.round(base + jitter);
        logger.warn(`embedding: rate limited, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
        await sleep(delay);
        attempt++;
        continue;
      }

      // Non-retryable error
      throw new EmbeddingError(
        `Jina AI request failed (status ${status ?? 'unknown'}): ${axiosErr.message}`,
        status,
      );
    }
  }

  throw new EmbeddingError('Jina AI: max retries exceeded');
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Embed an array of texts via Jina AI.
 *
 * - Model: jina-embeddings-v4 (configurable via JINA_EMBEDDING_MODEL)
 * - Dimensions: 512 (configurable via JINA_EMBEDDING_DIMENSIONS, Matryoshka truncation)
 * - Automatically batches into groups of 128
 * - Retries on 429 with exponential backoff (up to 3 retries)
 * - Returns one vector per input text, in order
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += JINA_BATCH_SIZE) {
    const batch = texts.slice(i, i + JINA_BATCH_SIZE);
    logger.debug(`embedding: batch ${Math.floor(i / JINA_BATCH_SIZE) + 1}, size=${batch.length}`);
    const batchVectors = await embedBatch(batch);
    results.push(...batchVectors);
  }

  return results;
}
