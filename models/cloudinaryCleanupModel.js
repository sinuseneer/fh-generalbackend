import mongoose from "mongoose";

const cloudinaryCleanupSchema = new mongoose.Schema(
  {
    public_id: { type: String, required: true, unique: true },
    attempts: { type: Number, default: 0 },
    next_attempt_at: { type: Date, default: Date.now },
    last_error: { type: String, default: "" },
    completed_at: { type: Date, default: null },
  },
  { timestamps: true }
);

cloudinaryCleanupSchema.index({ completed_at: 1, next_attempt_at: 1 });

export default mongoose.model("CloudinaryCleanup", cloudinaryCleanupSchema);
