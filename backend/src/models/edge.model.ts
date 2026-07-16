import mongoose, { Schema, Document, Model } from 'mongoose';

// =============================================================================
// Types
// =============================================================================

export interface IEdge extends Document {
  entityA: string;
  entityB: string;
  userId: string;
  memoryIds: mongoose.Types.ObjectId[];
  weight: number;
  createdAt: Date;
}

// =============================================================================
// Schema
// =============================================================================

const EdgeSchema = new Schema<IEdge>(
  {
    entityA: {
      type: String,
      required: true,
    },
    entityB: {
      type: String,
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
    memoryIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Memory',
      },
    ],
    weight: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// One edge per entity pair per user — entityA < entityB alphabetically
EdgeSchema.index({ userId: 1, entityA: 1, entityB: 1 }, { unique: true });

// Fast lookup by user (for global graph)
EdgeSchema.index({ userId: 1 });

// Fast lookup by memoryId
EdgeSchema.index({ memoryIds: 1 });

// =============================================================================
// Model
// =============================================================================

export const EdgeModel: Model<IEdge> =
  mongoose.models.Edge ?? mongoose.model<IEdge>('Edge', EdgeSchema);
