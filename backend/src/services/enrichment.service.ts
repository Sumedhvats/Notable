import Groq from 'groq-sdk';
import mongoose from 'mongoose';
import { ChunkModel } from '../models/chunk.model.js';
import { MemoryModel } from '../models/memory.model.js';
import { EntityModel } from '../models/entity.model.js';
import { EdgeModel } from '../models/edge.model.js';
import logger from '../utils/logger.js';

// =============================================================================
// Config
// =============================================================================

const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
const MAX_CONTENT_CHARS = 2000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// =============================================================================
// Alias map for entity deduplication
// =============================================================================

const ALIAS_MAP: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  k8s: 'kubernetes',
  py: 'python',
  rb: 'ruby',
  reactjs: 'react',
  'react.js': 'react',
  nextjs: 'next.js',
  vuejs: 'vue',
  'vue.js': 'vue',
  nodejs: 'node.js',
  'node': 'node.js',
  deno: 'deno',
  golang: 'go',
  postgres: 'postgresql',
  psql: 'postgresql',
  mongo: 'mongodb',
  gcp: 'google cloud platform',
  aws: 'amazon web services',
  'c#': 'csharp',
  'c++': 'cpp',
  tf: 'terraform',
  gh: 'github',
  vscode: 'visual studio code',
  'vs code': 'visual studio code',
};

// =============================================================================
// Types
// =============================================================================

interface ExtractedEntity {
  name: string;
  type: string;
}

interface EnrichmentResult {
  summary: string;
  tags: string[];
  entities: ExtractedEntity[];
}

// =============================================================================
// Prompt
// =============================================================================

const SYSTEM_PROMPT = `You are a metadata extractor. Given the text below, extract:
1. A concise summary (2-3 sentences max)
2. Relevant tags (3-8 lowercase single-word or hyphenated tags)
3. Named entities (people, organizations, technologies, concepts, places)

Rules:
- Extract ONLY from the provided text. Do NOT make up facts.
- Use full official names for entities, not abbreviations (e.g., "JavaScript" not "JS").
- Entity types must be one of: person, organization, technology, concept, place, other.
- Tags should be lowercase, hyphenated if multi-word (e.g., "machine-learning").

Respond with ONLY valid JSON in this exact format:
{
  "summary": "...",
  "tags": ["tag1", "tag2"],
  "entities": [{"name": "React", "type": "technology"}]
}`;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalize an entity name: trim, lowercase, apply alias map.
 */
function normalizeEntityName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return ALIAS_MAP[lower] ?? lower;
}

/**
 * Parse the Groq JSON response, handling malformed output gracefully.
 */
function parseEnrichmentResponse(content: string): EnrichmentResult {
  try {
    // Strip markdown code fences if present
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.toLowerCase().trim())
        : [],
      entities: Array.isArray(parsed.entities)
        ? parsed.entities.filter(
            (e: any) => typeof e.name === 'string' && typeof e.type === 'string',
          )
        : [],
    };
  } catch {
    logger.warn('enrichment: failed to parse Groq response as JSON');
    return { summary: '', tags: [], entities: [] };
  }
}

// =============================================================================
// Core enrichment logic
// =============================================================================

/**
 * Enrich a memory with auto-generated tags, summary, and extracted entities.
 * This function is designed to be called from the enrichment worker.
 */
export async function enrich(memoryId: string, userId: string): Promise<void> {
  const memoryOid = new mongoose.Types.ObjectId(memoryId);

  // 1. Reconstruct content from chunks (first ~2000 chars)
  const chunks = await ChunkModel.find({ memoryId: memoryOid })
    .sort({ chunkIndex: 1 })
    .lean();

  if (chunks.length === 0) {
    logger.warn(`enrichment: no chunks found for memory ${memoryId}, skipping`);
    return;
  }

  const fullText = chunks.map((c) => c.text).join('\n\n');
  const contentSnippet = fullText.slice(0, MAX_CONTENT_CHARS);

  // 2. Call Groq for structured extraction
  logger.debug(`enrichment: calling Groq for memory ${memoryId} (${contentSnippet.length} chars)`);

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: contentSnippet },
    ],
    temperature: 0.1,
  });

  const responseContent = completion.choices[0]?.message?.content;
  if (!responseContent) {
    logger.warn(`enrichment: empty response from Groq for memory ${memoryId}`);
    return;
  }

  const result = parseEnrichmentResponse(responseContent);

  // 3. Update memory with summary, merged tags, and entity names
  const memory = await MemoryModel.findById(memoryOid);
  if (!memory) {
    logger.warn(`enrichment: memory ${memoryId} not found, skipping`);
    return;
  }

  // Merge tags: existing user tags + new AI tags, deduplicated
  const existingTags = memory.tags || [];
  const mergedTags = [...new Set([...existingTags, ...result.tags])];

  // Normalize entity names for storage on memory document
  const entityNames = [...new Set(
    result.entities.map((e) => normalizeEntityName(e.name)),
  )];

  await MemoryModel.findByIdAndUpdate(memoryOid, {
    summary: result.summary || memory.summary,
    tags: mergedTags,
    entities: entityNames,
  });

  logger.debug(`enrichment: updated memory ${memoryId} with ${mergedTags.length} tags, ${entityNames.length} entities`);

  // 4. Upsert Entity documents
  const resolvedEntities: { name: string; type: string }[] = [];

  for (const raw of result.entities) {
    const canonicalName = normalizeEntityName(raw.name);
    const entityType = ['person', 'organization', 'technology', 'concept', 'place', 'other'].includes(raw.type)
      ? raw.type
      : 'other';

    // Upsert: create if not exists, add memoryId, add alias if different from canonical
    const rawLower = raw.name.trim().toLowerCase();
    const aliasUpdate = rawLower !== canonicalName ? { $addToSet: { aliases: rawLower } } : {};

    await EntityModel.findOneAndUpdate(
      { userId, name: canonicalName },
      {
        $setOnInsert: { name: canonicalName, type: entityType, userId },
        $addToSet: { memoryIds: memoryOid, ...aliasUpdate },
      },
      { upsert: true },
    );

    resolvedEntities.push({ name: canonicalName, type: entityType });
  }

  logger.debug(`enrichment: upserted ${resolvedEntities.length} entities for memory ${memoryId}`);

  // 5. Create co-occurrence edges for all entity pairs
  if (resolvedEntities.length >= 2) {
    const uniqueNames = [...new Set(resolvedEntities.map((e) => e.name))];

    for (let i = 0; i < uniqueNames.length; i++) {
      for (let j = i + 1; j < uniqueNames.length; j++) {
        // Sort alphabetically to ensure consistent edge direction
        const [entityA, entityB] = [uniqueNames[i], uniqueNames[j]].sort();

        await EdgeModel.findOneAndUpdate(
          { userId, entityA, entityB },
          {
            $setOnInsert: { userId, entityA, entityB },
            $addToSet: { memoryIds: memoryOid },
            $inc: { weight: 1 },
          },
          { upsert: true },
        );
      }
    }

    const edgeCount = (uniqueNames.length * (uniqueNames.length - 1)) / 2;
    logger.debug(`enrichment: upserted ${edgeCount} edges for memory ${memoryId}`);
  }

  logger.info(`enrichment: completed for memory ${memoryId}`);
}
