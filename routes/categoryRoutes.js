
import express from "express";
import Category_table from "../models/categoryModel.js";
import { createImageUpload, isUploadError } from "../utils/imageUpload.js";
import {
  deleteCloudinaryImageOrQueue,
  uploadImage,
} from "../utils/cloudinaryImages.js";
import { findImageUsage, hasImageUsage } from "../utils/imageReferences.js";

const router = express.Router();
const upload = createImageUpload({ fileSize: 5 * 1024 * 1024 });

/* ==========================================================
   1. ADD NEW CATEGORY
========================================================== */

router.post("/add", upload.single("image"), async (req, res) => {
  let uploadedImage = null;
  let saved = false;

  try {
    const { category_name } = req.body;

    if (!category_name || !req.file) {
      return res.status(400).json({
        success: false,
        message: "Category name and image are required",
      });
    }

    uploadedImage = await uploadImage(req.file, "fh-general-equipments/categories");

    const newCategory = new Category_table({
      category_name,
      category_image: uploadedImage.secure_url,
      category_image_public_id: uploadedImage.public_id,
      priority: 0,
    });

    await newCategory.save();
    saved = true;

    return res.json({
      success: true,
      message: "Category added successfully",
      category: newCategory,
    });
  } catch (error) {
    console.error("Error adding category:", error);

    // Clean up Cloudinary if the database save failed.
    if (uploadedImage && !saved) {
      try {
        await deleteCloudinaryImageOrQueue(uploadedImage.public_id);
      } catch (cleanupError) {
        console.error("Unable to clean up failed category upload:", cleanupError);
      }
    }

    return res.status(error.status === 400 ? 400 : 500).json({
      success: false,
      message: error.status === 400 ? error.message : "Server error while adding category",
    });
  }
});

/* ==========================================================
   2. ADMIN VIEW
========================================================== */

router.post("/view", async (req, res) => {
  try {
    const categories = await Category_table.find({})
      .sort({ priority: 1 });

    return res.json({
      success: true,
      categories,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* ==========================================================
   3. UPDATE PRIORITY (DRAG & DROP)
========================================================== */

router.post("/update-priority", async (req, res) => {
  try {
    const { categories } = req.body;

    if (!Array.isArray(categories)) {
      return res.status(400).json({
        success: false,
        message: "Invalid categories data",
      });
    }

    await Promise.all(
      categories.map((category) =>
        Category_table.findByIdAndUpdate(category.id, {
          priority: category.priority,
        })
      )
    );

    return res.json({
      success: true,
      message: "Category priorities updated successfully",
    });
  } catch (error) {
    console.error("Error updating priorities:", error);

    return res.status(500).json({
      success: false,
      message: "Error updating priorities",
      error: error.message,
    });
  }
});

/* ==========================================================
   4. USER VIEW
========================================================== */

router.get("/userview", async (req, res) => {
  try {
    const categories = await Category_table.find({})
      .sort({ priority: 1 });

    return res.json({
      success: true,
      categories,
    });
  } catch (error) {
    console.error("Error fetching categories for user view:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* ==========================================================
   5. SEARCH CATEGORY
========================================================== */

router.post("/search", async (req, res) => {
  try {
    const { category_name } = req.body;

    if (!category_name) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    const categories = await Category_table.find({
      category_name: {
        $regex: category_name,
        $options: "i",
      },
    }).sort({ priority: 1 });

    return res.json({
      success: true,
      categories,
    });
  } catch (error) {
    console.error("Error searching category:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* ==========================================================
   6. UPDATE CATEGORY (NAME + OPTIONAL IMAGE)
========================================================== */

router.put("/update/:id", upload.single("image"), async (req, res) => {
  let uploadedImage = null;
  let saved = false;

  try {
    const { id } = req.params;
    const { category_name } = req.body;

    if (!category_name) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    const category = await Category_table.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const oldImageUrl = category.category_image;
    const oldImagePublicId = category.category_image_public_id;

    if (req.file) {
      uploadedImage = await uploadImage(req.file, "fh-general-equipments/categories");
      category.category_image = uploadedImage.secure_url;
      category.category_image_public_id = uploadedImage.public_id;
    }

    category.category_name = category_name;

    await category.save();
    saved = true;

    // Delete the previous image only after the database save succeeds.
    if (uploadedImage && oldImagePublicId) {
      const usage = await findImageUsage({
        publicId: oldImagePublicId,
        secureUrl: oldImageUrl,
        exclude: { model: Category_table, id: category._id },
      });
      if (!hasImageUsage(usage)) {
        await deleteCloudinaryImageOrQueue(oldImagePublicId);
      }
    }

    return res.json({
      success: true,
      message: "Category updated successfully",
      category,
    });
  } catch (error) {
    console.error("Error updating category:", error);

    // Remove the newly uploaded image if the database update failed.
    if (uploadedImage) {
      if (!saved) {
        try {
          await deleteCloudinaryImageOrQueue(uploadedImage.public_id);
        } catch (cleanupError) {
          console.error("Unable to clean up failed category replacement:", cleanupError);
        }
      }
    }

    return res.status(error.status === 400 ? 400 : 500).json({
      success: false,
      message: error.status === 400 ? error.message : "Server error while updating category",
    });
  }
});

/* ==========================================================
   7. DELETE CATEGORY
========================================================== */

router.post("/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Category ID required",
      });
    }

    const category = await Category_table.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const usage = category.category_image_public_id
      ? await findImageUsage({
        publicId: category.category_image_public_id,
        secureUrl: category.category_image,
        exclude: { model: Category_table, id: category._id },
      })
      : null;

    await Category_table.findByIdAndDelete(id);

    if (category.category_image_public_id && !hasImageUsage(usage)) {
      await deleteCloudinaryImageOrQueue(category.category_image_public_id);
    }

    return res.json({
      success: true,
      message: "Category and its Cloudinary image deleted successfully",
    });

  } catch (error) {
    console.error("Category deletion error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while deleting category",
    });
  }
});
/* ==========================================================
   MULTER ERROR HANDLER
========================================================== */

router.use((err, req, res, next) => {
  if (isUploadError(err)) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  next(err);
});

export default router;
