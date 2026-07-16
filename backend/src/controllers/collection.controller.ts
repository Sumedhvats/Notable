import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { CollectionModel } from '../models/collection.model.js';
import { MemoryModel } from '../models/memory.model.js';
import logger from '../utils/logger.js';

// =============================================================================
// CRUD
// =============================================================================

export async function create(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    const collection = await CollectionModel.create({
      name: name.trim(),
      description: description?.trim() ?? '',
      userId,
    });

    logger.info(`Created collection ${collection._id} for user ${userId}`);
    return res.status(201).json({ collection });
  } catch (err: any) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A collection with this name already exists' });
    }
    logger.error('Error creating collection:', (err as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function listCollections(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;

    const collections = await CollectionModel.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    // Get memory counts for each collection
    const collectionsWithCounts = await Promise.all(
      collections.map(async (c) => {
        const memoryCount = await MemoryModel.countDocuments({
          userId,
          collections: c._id,
        });
        return { ...c, memoryCount };
      }),
    );

    return res.status(200).json({ collections: collectionsWithCounts });
  } catch (error) {
    logger.error('Error listing collections:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getCollection(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const collection = await CollectionModel.findOne({ _id: id, userId }).lean();
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Get memories in this collection
    const memories = await MemoryModel.find({ userId, collections: id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ collection, memories });
  } catch (error) {
    logger.error('Error fetching collection:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updateCollection(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const { name, description } = req.body;

    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name.trim();
    if (description !== undefined) update.description = description.trim();

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const collection = await CollectionModel.findOneAndUpdate(
      { _id: id, userId },
      update,
      { new: true },
    );

    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    logger.info(`Updated collection ${id}`);
    return res.status(200).json({ collection });
  } catch (err: any) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A collection with this name already exists' });
    }
    logger.error('Error updating collection:', (err as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteCollection(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const collection = await CollectionModel.findOne({ _id: id, userId });
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Remove collection reference from all memories
    await MemoryModel.updateMany(
      { userId, collections: id },
      { $pull: { collections: id } },
    );

    await CollectionModel.deleteOne({ _id: id });

    logger.info(`Deleted collection ${id} for user ${userId}`);
    return res.status(200).json({ message: 'Collection deleted' });
  } catch (error) {
    logger.error('Error deleting collection:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// =============================================================================
// Memory membership
// =============================================================================

export async function addMemory(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const { memoryId } = req.body;

    if (!memoryId) {
      return res.status(400).json({ error: 'memoryId is required' });
    }

    // Verify collection exists and belongs to user
    const collection = await CollectionModel.findOne({ _id: id, userId });
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Verify memory exists and belongs to user
    const memory = await MemoryModel.findOne({ _id: memoryId, userId });
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    // Add collection to memory (idempotent via $addToSet)
    await MemoryModel.findByIdAndUpdate(memoryId, {
      $addToSet: { collections: id },
    });

    logger.info(`Added memory ${memoryId} to collection ${id}`);
    return res.status(200).json({ message: 'Memory added to collection' });
  } catch (error) {
    logger.error('Error adding memory to collection:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function removeMemory(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { id, memoryId } = req.params;

    // Verify collection exists
    const collection = await CollectionModel.findOne({ _id: id, userId });
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    await MemoryModel.findOneAndUpdate(
      { _id: memoryId, userId },
      { $pull: { collections: id } },
    );

    logger.info(`Removed memory ${memoryId} from collection ${id}`);
    return res.status(200).json({ message: 'Memory removed from collection' });
  } catch (error) {
    logger.error('Error removing memory from collection:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
