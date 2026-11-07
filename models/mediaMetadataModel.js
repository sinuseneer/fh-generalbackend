import mongoose from "mongoose";

const mediaMetadataSchema = new mongoose.Schema(
  {
    public_id: { type: String, required: true, unique: true },
    folder: {
      type: String,
      enum: ["products", "posts", "banners", "categories"],
      required: true,
    },
    name: { type: String, required: true },
    secure_url: { type: String, required: true },
    format: { type: String, default: "webp" },
    bytes: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    favorite: { type: Boolean, default: false },
    title: { type: String, default: "" },
    alt: { type: String, default: "" },
    caption: { type: String, default: "" },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

mediaMetadataSchema.index({ folder: 1, name: 1 });
mediaMetadataSchema.index({ favorite: -1, createdAt: -1 });

export default mongoose.model("MediaMetadata", mediaMetadataSchema);
