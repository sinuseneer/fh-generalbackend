
import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    category_name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    category_image: {
      type: String,
      required: true,
    },

    // Cloudinary public ID used for image replacement and deletion
    category_image_public_id: {
      type: String,
      default: null,
    },

    priority: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const Category_table = mongoose.model(
  "Category_table",
  categorySchema
);

export default Category_table;
