import mongoose, { Schema, Document } from 'mongoose';
import { ContentType } from '../services/scraper.service.js';

export interface IMemory extends Document {
  url: string;
  title: string;
  description: string;
  contentType: ContentType;
  source: 'url' | 'extension';
  status: 'pending' | 'processing' | 'ready' | 'failed';
  tags: string[];
  collections: mongoose.Types.ObjectId[];
  chunkCount: number;
  errorMessage: string | null;
  userId: string; // Store as string to match better-auth userId
  metadata: {
    ogImage?: string;
    author?: string;
    siteName?: string;
    favicon?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const MemorySchema: Schema = new Schema(
  {
    url: { type: String, required: true },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    contentType: {
      type: String,
      required: true,
      enum: [
        'article',
        'tweet',
        'video',
        'reddit',
        'github',
        'stackoverflow',
        'wikipedia',
        'hn',
        'generic',
      ],
    },
    source: { type: String, required: true, enum: ['url', 'extension'] },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'processing', 'ready', 'failed'],
      default: 'pending',
    },
    tags: { type: [String], default: [] },
    collections: [{ type: Schema.Types.ObjectId, ref: 'Collection' }],
    chunkCount: { type: Number, default: 0 },
    errorMessage: { type: String, default: null },
    userId: { type: String, required: true },
    metadata: {
      ogImage: { type: String },
      author: { type: String },
      siteName: { type: String },
      favicon: { type: String },
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to prevent duplicate URLs per user
MemorySchema.index({ url: 1, userId: 1 }, { unique: true });
// Index for paginated list queries by user
MemorySchema.index({ userId: 1, createdAt: -1 });
// Index for monitoring status
MemorySchema.index({ status: 1 });

export const MemoryModel = mongoose.model<IMemory>('Memory', MemorySchema);
