import mongoose, { Schema, type Document } from 'mongoose';

export interface IUser extends Document {
  provider: 'google' | 'github';
  providerId: string;
  email: string;
  name: string;
  avatar: string;
  createdAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    provider: {
      type: String,
      required: true,
      enum: ['google', 'github'],
    },
    providerId: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    avatar: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true, // adds createdAt + updatedAt
  }
);

// Compound unique index: one account per provider+providerId combo
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });

// Index on email for cross-provider lookup
userSchema.index({ email: 1 });

const User = mongoose.model<IUser>('User', userSchema);

export default User;
