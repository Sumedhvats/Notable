import { MemoryModel } from '../models/memory.model.js';
import { CollectionModel } from '../models/collection.model.js';
import logger from '../utils/logger.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generate YAML frontmatter + summary body for a single memory.
 */
function formatMemoryMarkdown(memory: any): string {
  const frontmatter: Record<string, unknown> = {
    title: memory.title || 'Untitled',
    url: memory.url,
    date: memory.createdAt?.toISOString?.() ?? new Date().toISOString(),
  };

  if (memory.tags?.length > 0) {
    frontmatter.tags = memory.tags;
  }
  if (memory.entities?.length > 0) {
    frontmatter.entities = memory.entities;
  }
  if (memory.contentType) {
    frontmatter.type = memory.contentType;
  }

  // Build YAML frontmatter
  const yamlLines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map((v) => `  - ${v}`).join('\n')}`;
    }
    // Wrap string values in quotes if they contain special chars
    if (typeof value === 'string' && (value.includes(':') || value.includes('#'))) {
      return `${key}: "${value}"`;
    }
    return `${key}: ${value}`;
  });

  const yaml = `---\n${yamlLines.join('\n')}\n---`;
  const body = memory.summary || memory.description || '';

  return `${yaml}\n\n# ${memory.title || 'Untitled'}\n\n${body}\n`;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Export a single memory as a markdown string.
 */
export async function exportMemoryMarkdown(
  memoryId: string,
  userId: string,
): Promise<{ markdown: string; filename: string } | null> {
  const memory = await MemoryModel.findOne({ _id: memoryId, userId }).lean();
  if (!memory) {
    return null;
  }

  const markdown = formatMemoryMarkdown(memory);

  // Generate a safe filename from the title
  const safeTitle = (memory.title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const filename = `${safeTitle}.md`;

  logger.debug(`export: generated markdown for memory ${memoryId} (${markdown.length} chars)`);
  return { markdown, filename };
}

/**
 * Export all memories in a collection as a single markdown string.
 */
export async function exportCollectionMarkdown(
  collectionId: string,
  userId: string,
): Promise<{ markdown: string; filename: string } | null> {
  const collection = await CollectionModel.findOne({ _id: collectionId, userId }).lean();
  if (!collection) {
    return null;
  }

  // Find all memories belonging to this collection
  const memories = await MemoryModel.find({
    userId,
    collections: collectionId,
  })
    .sort({ createdAt: -1 })
    .lean();

  const header = `# ${collection.name}\n\n${collection.description || ''}\n\n---\n\n`;
  const memoryMarkdowns = memories.map((m) => formatMemoryMarkdown(m));
  const markdown = header + memoryMarkdowns.join('\n---\n\n');

  const safeTitle = (collection.name || 'collection')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const filename = `${safeTitle}.md`;

  logger.debug(`export: generated collection markdown for ${collectionId} (${memories.length} memories)`);
  return { markdown, filename };
}
