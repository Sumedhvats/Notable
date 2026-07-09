import mongoose, { Schema, Document, Model } from 'mongoose';

// =============================================================================
// Types
// =============================================================================

export interface IChunk extends Document {
  memoryId: mongoose.Types.ObjectId;
  userId: string;
  chunkIndex: number;
  text: string;
  createdAt: Date;
}

// =============================================================================
// Schema
// =============================================================================

const ChunkSchema = new Schema<IChunk>(
  {
    memoryId: {
      type: Schema.Types.ObjectId,
      required: true,
      // ref will be set once Memory model (Stage 2) exists
    },
    userId: {
      type: String,
      required: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// Compound unique index — enforces ordering, enables idempotent upserts
ChunkSchema.index({ memoryId: 1, chunkIndex: 1 }, { unique: true });

// Secondary index for fast delete-by-user and delete-by-memory
ChunkSchema.index({ userId: 1 });
ChunkSchema.index({ memoryId: 1 });

// =============================================================================
// Model
// =============================================================================

export const ChunkModel: Model<IChunk> =
  mongoose.models.Chunk ?? mongoose.model<IChunk>('Chunk', ChunkSchema);
