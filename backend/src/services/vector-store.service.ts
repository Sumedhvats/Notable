import { Pinecone } from '@pinecone-database/pinecone';
import { ChunkModel } from '../models/chunk.model.js';
import logger from '../utils/logger.js';
import type mongoose from 'mongoose';

// =============================================================================
// Config & singleton client
// =============================================================================

let _pinecone: Pinecone | null = null;

function getPinecone(): Pinecone {
  if (!_pinecone) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) throw new Error('PINECONE_API_KEY is not set');
    _pinecone = new Pinecone({ apiKey });
  }
  return _pinecone;
}

function getIndex() {
  const indexName = process.env.PINECONE_INDEX_NAME ?? 'notable';
  return getPinecone().index(indexName);
}

/**
 * Pinecone conventions:
 *  - namespace  = userId          (isolates each user's vectors)
 *  - vector ID  = `{memoryId}_{chunkIndex}`  (deterministic, idempotent upserts)
 */
function vectorId(memoryId: string, chunkIndex: number): string {
  return `${memoryId}_${chunkIndex}`;
}

function parseVectorId(id: string): { memoryId: string; chunkIndex: number } {
  const lastUnderscore = id.lastIndexOf('_');
  return {
    memoryId: id.slice(0, lastUnderscore),
    chunkIndex: parseInt(id.slice(lastUnderscore + 1), 10),
  };
}

// =============================================================================
// Types
// =============================================================================

export interface ChunkInput {
  text: string;
  index: number;
}

export interface ScoredChunk {
  chunkId: string;
  score: number;
  text: string;
  memoryId: string;
  chunkIndex: number;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Upsert chunk vectors to Pinecone and back up chunk text to MongoDB.
 *
 * Write order: Pinecone first, then MongoDB. A crash between the two leaves
 * Pinecone ahead of MongoDB (recoverable by re-embedding). The reverse order
 * would be worse (orphaned Mongo docs with no vectors).
 */
export async function upsertChunks(
  userId: string,
  memoryId: string | mongoose.Types.ObjectId,
  chunks: ChunkInput[],
  vectors: number[][],
): Promise<void> {
  if (chunks.length !== vectors.length) {
    throw new Error(`upsertChunks: chunks (${chunks.length}) and vectors (${vectors.length}) length mismatch`);
  }
  if (chunks.length === 0) return;

  const memoryIdStr = memoryId.toString();
  const index = getIndex();
  const ns = index.namespace(userId);

  // 1. Upsert to Pinecone
  const records = chunks.map((c, i) => ({
    id: vectorId(memoryIdStr, c.index),
    values: vectors[i],
    metadata: { memoryId: memoryIdStr, chunkIndex: c.index, userId, chunkText: c.text },
  }));

  await ns.upsert({ records });
  logger.debug(`vector-store: upserted ${records.length} vectors for memory=${memoryIdStr}`);

  // 2. Backup chunk text to MongoDB (deleteMany + insertMany for idempotency)
  await ChunkModel.deleteMany({ memoryId });
  await ChunkModel.insertMany(
    chunks.map((c) => ({
      memoryId,
      userId,
      chunkIndex: c.index,
      text: c.text,
    })),
  );
  logger.debug(`vector-store: saved ${chunks.length} chunk docs to MongoDB for memory=${memoryIdStr}`);
}

/**
 * Query Pinecone for the most similar chunks to a given vector.
 * Namespace = userId so results are automatically scoped to this user.
 */
export async function query(
  userId: string,
  vector: number[],
  topK = 5,
): Promise<ScoredChunk[]> {
  const index = getIndex();
  const ns = index.namespace(userId);

  const result = await ns.query({
    vector,
    topK,
    includeMetadata: true,
  });

  return (result.matches ?? []).map((m) => {
    const { memoryId, chunkIndex } = parseVectorId(m.id);
    return {
      chunkId: m.id,
      score: m.score ?? 0,
      text: (m.metadata?.chunkText as string) ?? '',
      memoryId,
      chunkIndex,
    };
  });
}

/**
 * Find memories similar to the given memory by fetching its first chunk's
 * vector and querying with it.
 */
export async function querySimilar(
  userId: string,
  memoryId: string,
  topK = 5,
): Promise<ScoredChunk[]> {
  const index = getIndex();
  const ns = index.namespace(userId);

  const firstChunkId = vectorId(memoryId, 0);
  const fetchResult = await ns.fetch({ ids: [firstChunkId] });
  const record = fetchResult.records?.[firstChunkId];

  if (!record?.values) {
    logger.warn(`vector-store: no vector found for ${firstChunkId}, cannot querySimilar`);
    return [];
  }

  return query(userId, record.values, topK);
}

/**
 * Delete all chunks for a memory from both Pinecone and MongoDB.
 *
 * Pinecone doesn't support prefix deletion, so we fetch all chunk IDs from
 * MongoDB first (which we own), then delete those specific IDs from Pinecone.
 */
export async function deleteByMemory(userId: string, memoryId: string | mongoose.Types.ObjectId): Promise<void> {
  const memoryIdStr = memoryId.toString();
  const index = getIndex();
  const ns = index.namespace(userId);

  // Get all chunk indices from MongoDB so we can build exact vector IDs
  const chunks = await ChunkModel.find({ memoryId }, { chunkIndex: 1 }).lean();
  const ids = chunks.map((c) => vectorId(memoryIdStr, c.chunkIndex));

  if (ids.length > 0) {
    await ns.deleteMany({ ids });
    logger.debug(`vector-store: deleted ${ids.length} vectors for memory=${memoryIdStr}`);
  }

  await ChunkModel.deleteMany({ memoryId });
  logger.debug(`vector-store: deleted chunk docs for memory=${memoryIdStr}`);
}
