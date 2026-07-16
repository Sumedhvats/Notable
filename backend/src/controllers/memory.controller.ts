import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { MemoryModel } from '../models/memory.model.js';
import { memoryQueue } from '../config/queue.js';
import { deleteByMemory, querySimilar } from '../services/vector-store.service.js';
import { exportMemoryMarkdown, exportCollectionMarkdown } from '../services/export.service.js';
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

export async function list(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    // Build filter query
    const filter: Record<string, unknown> = { userId };

    // Text search
    const q = req.query.q as string;
    if (q && q.trim().length > 0) {
      filter.$text = { $search: q.trim() };
    }

    // Content type filter
    const type = req.query.type as string;
    if (type) {
      filter.contentType = type;
    }

    // Tags filter (comma-separated)
    const tagsParam = req.query.tags as string;
    if (tagsParam) {
      const tags = tagsParam.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) {
        filter.tags = { $all: tags };
      }
    }

    // Entities filter (comma-separated)
    const entitiesParam = req.query.entities as string;
    if (entitiesParam) {
      const entities = entitiesParam.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
      if (entities.length > 0) {
        filter.entities = { $all: entities };
      }
    }

    // Collection filter
    const collectionId = req.query.collectionId as string;
    if (collectionId) {
      filter.collections = collectionId;
    }

    // Date range filter
    const from = req.query.from as string;
    const to = req.query.to as string;
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.$gte = new Date(from);
      if (to) dateFilter.$lte = new Date(to);
      filter.createdAt = dateFilter;
    }

    // Sort
    const sortParam = req.query.sort as string;
    let sort: Record<string, 1 | -1> = { createdAt: -1 };
    if (sortParam === 'oldest') sort = { createdAt: 1 };
    else if (sortParam === 'title') sort = { title: 1 };
    // If text search is active, sort by relevance score by default
    if (q && sortParam !== 'oldest' && sortParam !== 'title') {
      sort = { score: { $meta: 'textScore' } as any, createdAt: -1 };
    }

    const query = MemoryModel.find(filter);

    // Add text score projection for text search
    if (q) {
      query.select({ score: { $meta: 'textScore' } });
    }

    const [memories, total] = await Promise.all([
      query
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      MemoryModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      memories,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    logger.error('Error listing memories:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function get(req: AuthenticatedRequest, res: Response) {
  try {
    const id = req.params.id as string;
    const userId = req.userId!;

    const memory = await MemoryModel.findOne({ _id: id, userId }).lean();
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    return res.status(200).json({ memory });
  } catch (error) {
    logger.error('Error fetching memory:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteMemory(req: AuthenticatedRequest, res: Response) {
  try {
    const id = req.params.id as string;
    const userId = req.userId!;

    const memory = await MemoryModel.findOne({ _id: id, userId });
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    await deleteByMemory(userId, id);
    await MemoryModel.deleteOne({ _id: id });

    logger.info(`Deleted memory ${id} for user ${userId}`);
    return res.status(200).json({ message: 'Memory deleted' });
  } catch (error) {
    logger.error('Error deleting memory:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function rescrape(req: AuthenticatedRequest, res: Response) {
  try {
    const id = req.params.id as string;
    const userId = req.userId!;

    const memory = await MemoryModel.findOne({ _id: id, userId });
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    if (memory.source === 'extension') {
      return res.status(400).json({ error: 'Cannot rescrape extension-sourced memories. Use the extension to re-save.' });
    }

    await deleteByMemory(userId, id);

    await MemoryModel.findByIdAndUpdate(id, {
      status: 'pending',
      chunkCount: 0,
      errorMessage: null,
    });

    await memoryQueue.add(`memory-rescrape-${id}`, {
      memoryId: id,
      userId,
      mode: 'url',
      url: memory.url,
    });

    logger.info(`Queued rescrape job for memory ${id}`);
    return res.status(202).json({ memory: { _id: id, status: 'pending' } });
  } catch (error) {
    logger.error('Error rescraping memory:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getRelated(req: AuthenticatedRequest, res: Response) {
  try {
    const id = req.params.id as string;
    const userId = req.userId!;

    const memory = await MemoryModel.findOne({ _id: id, userId });
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    const matches = await querySimilar(userId, id, 10);

    // Deduplicate memoryIds and exclude self
    const uniqueMemoryIds = [...new Set(
      matches
        .map((m) => m.memoryId)
        .filter((mid) => mid !== id),
    )];

    // Single batch query instead of N+1 individual findById calls
    const memories = await MemoryModel.find(
      { _id: { $in: uniqueMemoryIds } },
      { title: 1, url: 1, description: 1 },
    ).lean();

    const memoryMap = new Map(memories.map((m) => [m._id.toString(), m]));

    // Build results preserving Pinecone's relevance ordering
    const relatedMemories = [];
    const seen = new Set<string>();
    for (const match of matches) {
      if (!seen.has(match.memoryId) && match.memoryId !== id) {
        seen.add(match.memoryId);
        const relMemory = memoryMap.get(match.memoryId);
        if (relMemory) {
          relatedMemories.push({
            _id: relMemory._id,
            title: relMemory.title,
            url: relMemory.url,
            description: relMemory.description,
            score: match.score,
          });
        }
      }
    }

    return res.status(200).json({ memories: relatedMemories });
  } catch (error) {
    logger.error('Error fetching related memories:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// =============================================================================
// Markdown Export
// =============================================================================

export async function exportMemoryMd(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;
    const id = req.params.id as string;

    const result = await exportMemoryMarkdown(id, userId);
    if (!result) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.status(200).send(result.markdown);
  } catch (error) {
    logger.error('Error exporting memory:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function exportCollectionMd(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;
    const id = req.params.id as string;

    const result = await exportCollectionMarkdown(id, userId);
    if (!result) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.status(200).send(result.markdown);
  } catch (error) {
    logger.error('Error exporting collection:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
