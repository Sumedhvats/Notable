import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { getGlobalGraph, getMemoryGraph } from '../controllers/graph.controller.js';

const router = Router();

// Global knowledge graph (all entities + edges for user)
router.get('/graph', requireAuth, getGlobalGraph);

// Per-memory graph
router.get('/memories/:id/graph', requireAuth, getMemoryGraph);

export default router;
