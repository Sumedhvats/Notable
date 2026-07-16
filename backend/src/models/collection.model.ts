import mongoose, { Schema, Document, Model } from 'mongoose';

// =============================================================================
// Types
// =============================================================================

export interface ICollection extends Document {
  name: string;
  description: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Schema
// =============================================================================

const CollectionSchema = new Schema<ICollection>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    userId: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// One collection name per user
CollectionSchema.index({ userId: 1, name: 1 }, { unique: true });

// Fast lookup by user
CollectionSchema.index({ userId: 1, createdAt: -1 });

// =============================================================================
// Model
// =============================================================================

export const CollectionModel: Model<ICollection> =
  mongoose.models.Collection ?? mongoose.model<ICollection>('Collection', CollectionSchema);
