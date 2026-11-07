import express from "express";
import Blog_table from "../models/postModel.js";
import { createImageUpload, isUploadError } from "../utils/imageUpload.js";
import {
  deleteCloudinaryImageOrQueue,
  uploadImage,
} from "../utils/cloudinaryImages.js";
import { findImageUsage, hasImageUsage } from "../utils/imageReferences.js";

const router = express.Router();
const upload = createImageUpload({ fileSize: 10 * 1024 * 1024 });

/* ============================================================
   CREATE NEW POST
============================================================ */
router.post("/", upload.single("image"), async (req, res) => {
  let uploadedImage;
  let saved = false;
  try {
    const { title, shortDescription, longDescription, date } = req.body;

    if (!req.file)
      return res.status(400).json({ message: "Image is required" });

    uploadedImage = await uploadImage(req.file, "fh-general-equipments/posts");

    const newPost = await Blog_table.create({
      title,
      shortDescription,
      longDescription,
      date,
      image: uploadedImage.secure_url,
      image_public_id: uploadedImage.public_id,
    });

    saved = true;
    res.status(201).json(newPost);
  } catch (err) {
    console.error("Failed to add post:", err);
    if (uploadedImage && !saved) {
      await deleteCloudinaryImageOrQueue(uploadedImage.public_id).catch((cleanupError) => {
        console.error("Unable to clean up failed post upload:", cleanupError);
      });
    }
    res.status(err.status === 400 ? 400 : 500).json({
      message: err.status === 400 ? err.message : "Failed to add post",
    });
  }
});

/* ============================================================
   GET ALL POSTS
============================================================ */
router.get("/", async (req, res) => {
  try {
    const posts = await Blog_table.find().sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch posts" });
  }
});

/* ============================================================
   GET SINGLE POST BY ID
============================================================ */
router.get("/:id", async (req, res) => {
  try {
    const post = await Blog_table.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch post" });
  }
});

/* ============================================================
   UPDATE / EDIT POST
   (optional image upload)
============================================================ */
router.put("/:id", upload.single("image"), async (req, res) => {
  let uploadedImage;
  let saved = false;
  try {
    const { title, shortDescription, longDescription, date } = req.body;
    const post = await Blog_table.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });
    const oldImage = { publicId: post.image_public_id, secureUrl: post.image };

    if (title !== undefined) post.title = title;
    if (shortDescription !== undefined) post.shortDescription = shortDescription;
    if (longDescription !== undefined) post.longDescription = longDescription;
    if (date !== undefined) post.date = date;
    if (req.file) {
      uploadedImage = await uploadImage(req.file, "fh-general-equipments/posts");
      post.image = uploadedImage.secure_url;
      post.image_public_id = uploadedImage.public_id;
    }

    await post.save();
    saved = true;

    if (uploadedImage && oldImage.publicId) {
      const usage = await findImageUsage({
        ...oldImage,
        exclude: { model: Blog_table, id: post._id },
      });
      if (!hasImageUsage(usage)) {
        await deleteCloudinaryImageOrQueue(oldImage.publicId);
      }
    }

    res.json(post);
  } catch (err) {
    console.error("Failed to update post:", err);
    if (uploadedImage && !saved) {
      await deleteCloudinaryImageOrQueue(uploadedImage.public_id).catch((cleanupError) => {
        console.error("Unable to clean up failed post replacement:", cleanupError);
      });
    }
    res.status(err.status === 400 ? 400 : 500).json({
      message: err.status === 400 ? err.message : "Failed to update post",
    });
  }
});

/* ============================================================
   DELETE POST
============================================================ */
router.delete("/:id", async (req, res) => {
  try {
    const post = await Blog_table.findById(req.params.id);
    if (!post)
      return res.status(404).json({ message: "Post not found" });

    const usage = post.image_public_id
      ? await findImageUsage({
        publicId: post.image_public_id,
        secureUrl: post.image,
        exclude: { model: Blog_table, id: post._id },
      })
      : null;
    await post.deleteOne();

    if (post.image_public_id) {
      if (!hasImageUsage(usage)) {
        await deleteCloudinaryImageOrQueue(post.image_public_id);
      }
    }

    res.json({ message: "Post deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete post" });
  }
});

export default router;
