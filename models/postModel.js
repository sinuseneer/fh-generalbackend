import mongoose from "mongoose";

const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    shortDescription: {
      type: String,
      required: true,
      trim: true,
    },

    longDescription: {
      type: String,
      required: true,
    },
    image_public_id: {
      type: String,
      default: null,
    },

    image: {
      type: String,
      required: true,
    }
  },
  { timestamps: true }   // <-- createdAt and updatedAt auto added
);

const Blog_table= mongoose.model("Blog_table", blogSchema);
export default Blog_table;
