import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { EntityModel } from '../models/entity.model.js';
import { EdgeModel } from '../models/edge.model.js';
import { MemoryModel } from '../models/memory.model.js';
import logger from '../utils/logger.js';

/**
 * GET /api/graph
 * Returns all entities (nodes) and co-occurrence edges (links) for the user.
 */
export async function getGlobalGraph(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;

    const [entities, edges] = await Promise.all([
      EntityModel.find({ userId }).lean(),
      EdgeModel.find({ userId }).lean(),
    ]);

    const nodes = entities.map((e) => ({
      id: e.name,
      type: e.type,
      aliases: e.aliases,
      memoryCount: e.memoryIds.length,
    }));

    const links = edges.map((e) => ({
      source: e.entityA,
      target: e.entityB,
      weight: e.weight,
      memoryCount: e.memoryIds.length,
    }));

    return res.status(200).json({ nodes, links });
  } catch (error) {
    logger.error('Error fetching global graph:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/memories/:id/graph
 * Returns entities and co-occurrence edges for a single memory.
 */
export async function getMemoryGraph(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    // Verify memory exists
    const memory = await MemoryModel.findOne({ _id: id, userId }).lean();
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    // Get entities linked to this memory
    const entities = await EntityModel.find({
      userId,
      memoryIds: id,
    }).lean();

    const entityNames = new Set(entities.map((e) => e.name));

    // Get edges where both entities are in this memory's entity set
    const edges = await EdgeModel.find({
      userId,
      memoryIds: id,
    }).lean();

    // Filter to only edges where both entities belong to this memory
    const filteredEdges = edges.filter(
      (e) => entityNames.has(e.entityA) && entityNames.has(e.entityB),
    );

    const nodes = entities.map((e) => ({
      id: e.name,
      type: e.type,
      aliases: e.aliases,
      memoryCount: e.memoryIds.length,
    }));

    const links = filteredEdges.map((e) => ({
      source: e.entityA,
      target: e.entityB,
      weight: e.weight,
      memoryCount: e.memoryIds.length,
    }));

    return res.status(200).json({ nodes, links });
  } catch (error) {
    logger.error('Error fetching memory graph:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
