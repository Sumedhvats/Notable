import mongoose, { Schema, Document, Model } from 'mongoose';

// =============================================================================
// Types
// =============================================================================

export interface IEntity extends Document {
  name: string;
  type: string;
  aliases: string[];
  userId: string;
  memoryIds: mongoose.Types.ObjectId[];
  createdAt: Date;
}

// =============================================================================
// Schema
// =============================================================================

const EntitySchema = new Schema<IEntity>(
  {
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['person', 'organization', 'technology', 'concept', 'place', 'other'],
    },
    aliases: {
      type: [String],
      default: [],
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
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// One canonical entity per name per user
EntitySchema.index({ userId: 1, name: 1 }, { unique: true });

// Fast lookup by user (for global graph)
EntitySchema.index({ userId: 1 });

// Fast lookup by memoryId (for per-memory graph)
EntitySchema.index({ memoryIds: 1 });

// =============================================================================
// Model
// =============================================================================

export const EntityModel: Model<IEntity> =
  mongoose.models.Entity ?? mongoose.model<IEntity>('Entity', EntitySchema);
