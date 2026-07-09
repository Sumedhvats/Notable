import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { MemoryModel } from '../models/memory.model.js';
import { memoryQueue } from '../config/queue.js';
import logger from '../utils/logger.js';

export async function createFromUrl(req: AuthenticatedRequest, res: Response) {
  try {
    const { url } = req.body;
    const userId = req.userId!;

    // 1. Pre-flight check for duplicate URL
    const existing = await MemoryModel.findOne({ url, userId });
    if (existing) {
      logger.info(`Memory already exists for user ${userId} and URL ${url}`);
      return res.status(200).json({ memory: existing, duplicate: true });
    }

    // 2. Try creating document, catching race-condition duplicates
    let memory;
    try {
      memory = await MemoryModel.create({
        url,
        userId,
        status: 'pending',
        source: 'url',
        contentType: 'generic', // Placeholder, updated by worker
      });
    } catch (err: any) {
      if (err.code === 11000) {
        logger.info(`Race condition duplicate caught for user ${userId} and URL ${url}`);
        const duplicate = await MemoryModel.findOne({ url, userId });
        if (duplicate) {
          return res.status(200).json({ memory: duplicate, duplicate: true });
        }
      }
      throw err;
    }

    // 3. Queue the background processing job
    await memoryQueue.add(`memory-url-${memory._id}`, {
      memoryId: memory._id.toString(),
      userId,
      mode: 'url',
      url,
    });

    logger.info(`Queued URL processing job for memory ${memory._id}`);
    return res.status(202).json({ memory });
  } catch (error) {
    logger.error('Error creating memory from URL:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createFromExtension(req: AuthenticatedRequest, res: Response) {
  try {
    const { url, title, description, content, contentType, metadata } = req.body;
    const userId = req.userId!;

    // 1. Pre-flight check for duplicate URL
    const existing = await MemoryModel.findOne({ url, userId });
    if (existing) {
      logger.info(`Memory already exists for user ${userId} and URL ${url}`);
      return res.status(200).json({ memory: existing, duplicate: true });
    }

    // 2. Try creating document, catching race-condition duplicates
    let memory;
    try {
      memory = await MemoryModel.create({
        url,
        userId,
        title,
        description,
        status: 'pending',
        source: 'extension',
        contentType,
        metadata,
      });
    } catch (err: any) {
      if (err.code === 11000) {
        logger.info(`Race condition duplicate caught for user ${userId} and URL ${url}`);
        const duplicate = await MemoryModel.findOne({ url, userId });
        if (duplicate) {
          return res.status(200).json({ memory: duplicate, duplicate: true });
        }
      }
      throw err;
    }

    // 3. Queue the background processing job (skip scraping)
    await memoryQueue.add(`memory-ext-${memory._id}`, {
      memoryId: memory._id.toString(),
      userId,
      mode: 'extension',
      content,
      contentType,
    });

    logger.info(`Queued extension processing job for memory ${memory._id}`);
    return res.status(202).json({ memory });
  } catch (error) {
    logger.error('Error creating memory from extension:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getStatus(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;
    const userId = req.userId!;

    const memory = await MemoryModel.findOne({ _id: id, userId });
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    return res.status(200).json({
      status: memory.status,
      chunkCount: memory.chunkCount,
      errorMessage: memory.errorMessage,
    });
  } catch (error) {
    logger.error('Error fetching memory status:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
