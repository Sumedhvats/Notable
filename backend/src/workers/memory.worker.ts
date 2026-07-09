import { Worker } from 'bullmq';
import { redis } from '../config/queue.js';
import { scrape } from '../services/scraper.service.js';
import { chunk } from '../services/chunker.service.js';
import { embed } from '../services/embedding.service.js';
import { upsertChunks } from '../services/vector-store.service.js';
import { MemoryModel } from '../models/memory.model.js';
import logger from '../utils/logger.js';

export const memoryWorker = new Worker(
  'memory-pipeline',
  async (job) => {
    const { memoryId, userId, mode } = job.data;
    logger.info(`Worker processing job ${job.id} for memory ${memoryId} (user ${userId}, mode ${mode})`);

    // 1. Update status to processing
    await MemoryModel.findByIdAndUpdate(memoryId, {
      status: 'processing',
      errorMessage: null,
    });

    try {
      let content: string;
      let contentType: string;
      let title: string = '';
      let description: string = '';
      let metadata: any = {};

      if (mode === 'url') {
        const { url } = job.data;
        logger.debug(`Worker scraping URL: ${url}`);
        const scraped = await scrape(url);
        content = scraped.content;
        contentType = scraped.contentType;
        title = scraped.title;
        description = scraped.description;
        metadata = scraped.metadata;
      } else {
        const { content: extContent, contentType: extContentType } = job.data;
        content = extContent;
        contentType = extContentType;

        const memory = await MemoryModel.findById(memoryId);
        if (!memory) {
          throw new Error(`Memory ${memoryId} not found in database`);
        }
        title = memory.title;
        description = memory.description;
        metadata = memory.metadata;
      }

      // 2. Chunker
      logger.debug(`Worker chunking content (length=${content.length}, type=${contentType})`);
      const chunks = await chunk(content, contentType as any);

      // 3. Embedder
      logger.debug(`Worker embedding ${chunks.length} chunks`);
      const chunkTexts = chunks.map((c) => c.text);
      const vectors = await embed(chunkTexts);

      // 4. Vector Store
      logger.debug(`Worker upserting chunks to vector store`);
      await upsertChunks(userId, memoryId, chunks, vectors);

      // 5. Update memory document
      await MemoryModel.findByIdAndUpdate(memoryId, {
        status: 'ready',
        title,
        description,
        contentType,
        metadata,
        chunkCount: chunks.length,
      });

      logger.info(`Worker job ${job.id} completed successfully for memory ${memoryId}`);
    } catch (err) {
      const errMsg = (err as Error).message;
      logger.error(`Worker job ${job.id} failed for memory ${memoryId}: ${errMsg}`);

      await MemoryModel.findByIdAndUpdate(memoryId, {
        status: 'failed',
        errorMessage: errMsg,
      });

      // Rethrow to let BullMQ handle retry attempts and backoffs
      throw err;
    }
  },
  {
    connection: redis as any,
    concurrency: 1, // Respect API limits by processing sequentially
  }
);

// Listen to worker errors to prevent uncaught exceptions
memoryWorker.on('error', (err) => {
  logger.error('Memory worker encountered a global error:', err.message);
});
