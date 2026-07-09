import { z } from 'zod';

export const createMemorySchema = z.object({
  url: z.string().url('Invalid URL format'),
});

export const createFromExtensionSchema = z.object({
  url: z.string().url('Invalid URL format'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().default(''),
  content: z.string().min(1, 'Content is required'),
  contentType: z.enum([
    'article',
    'tweet',
    'video',
    'reddit',
    'github',
    'stackoverflow',
    'wikipedia',
    'hn',
    'generic',
  ]),
  metadata: z
    .object({
      ogImage: z.string().optional(),
      author: z.string().optional(),
      siteName: z.string().optional(),
      favicon: z.string().optional(),
    })
    .optional(),
});
