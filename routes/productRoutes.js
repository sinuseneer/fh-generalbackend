import express from "express";
import Product_table from "../models/productModel.js";
import ProductImageTable from "../models/productImage.js";
import { createImageUpload, isUploadError } from "../utils/imageUpload.js";
import {
  deleteCloudinaryImageOrQueue,
  uploadImage,
} from "../utils/cloudinaryImages.js";
import { findImageUsage, hasImageUsage } from "../utils/imageReferences.js";

const router = express.Router();

const uploadProductImage = createImageUpload({ fileSize: 10 * 1024 * 1024 });

// admin edit produt images 
router.put("/replace-image/:imageId",
  uploadProductImage.single("image"),
  async (req, res) => {
    let uploadedImage;
    let saved = false;
    try {
      const { imageId } = req.params;

      // 1️⃣ Check file uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No image uploaded"
        });
      }

      // 2️⃣ Find the image record in DB
      const image = await ProductImageTable.findById(imageId);
      if (!image) {
        return res.status(404).json({
          success: false,
          message: "Image not found"
        });
      }

      const oldImage = {
        publicId: image.public_id,
        secureUrl: image.image_path,
      };
      uploadedImage = await uploadImage(req.file, "fh-general-equipments/products");
      image.image_path = uploadedImage.secure_url;
      image.public_id = uploadedImage.public_id;
      await image.save();
      saved = true;

      if (oldImage.publicId) {
        try {
          const usage = await findImageUsage({
            ...oldImage,
            exclude: { model: ProductImageTable, id: image._id },
          });
          if (!hasImageUsage(usage)) {
            await deleteCloudinaryImageOrQueue(oldImage.publicId);
          }
        } catch (cleanupError) {
          console.error("Unable to clean up replaced product image:", cleanupError);
        }
      }

      res.json({
        success: true,
        message: "Image replaced successfully"
      });

    } catch (err) {
      if (uploadedImage && !saved) {
        await deleteCloudinaryImageOrQueue(uploadedImage.public_id).catch((cleanupError) => {
          console.error("Unable to clean up failed product replacement:", cleanupError);
        });
      }
      res.status(err.status === 400 ? 400 : 500).json({
        success: false,
        message: err.message
      });
    }
  }
);



router.delete("/delete-image/:imageId", async (req, res) => {
  try {
    const { imageId } = req.params;

    // 1️⃣ Find image record
    const image = await ProductImageTable.findById(imageId);
    if (!image) {
      return res.status(404).json({
        success: false,
        message: "Image not found"
      });
    }

    const usage = await findImageUsage({
      publicId: image.public_id,
      secureUrl: image.image_path,
      exclude: { model: ProductImageTable, id: image._id },
    });
    await ProductImageTable.findByIdAndDelete(imageId);
    if (image.public_id && !hasImageUsage(usage)) {
      await deleteCloudinaryImageOrQueue(image.public_id);
    }

    res.json({
      success: true,
      message: "Image deleted successfully"
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});






// fetch 10 latest product to user featured product 
router.get("/latest", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const products = await Product_table.find()
      .sort({ date: -1 })
      .limit(limit)
      .populate("CAT_ID", "category_name")
      .lean();

    const productsWithImages = await Promise.all(
      products.map(async (product) => {
        let mainImage = await ProductImageTable.findOne({
          PRODUCT_ID: product._id,
          is_main: true,
        });

        // If no main image found, pick the first uploaded image
        if (!mainImage) {
          mainImage = await ProductImageTable.findOne({ PRODUCT_ID: product._id }).sort({
            _id: -1,
          });
        }

        return {
          _id: product._id,
          prod_id: product.prod_id,
          product_name: product.product_name,
          description: product.description,
          product_info: product.product_info || [],
          category: product.CAT_ID?.category_name || "Uncategorized",
          main_image: mainImage ? mainImage.image_path : null, // ✅ attach image
        };
      })
    );

    res.json({ success: true, products: productsWithImages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// ======================================================================

// USER view of all products with main image
// ======================================================================


router.get("/userview", async (req, res) => {
  try {
    // Get all products
    const products = await Product_table.find()
     .sort({ date: -1 })
      .populate("CAT_ID", "category_name")
      .lean();

    // For each product, find the main image or first image
    const productsWithMainImage = await Promise.all(
      products.map(async (product) => {
        // Find the main image for this product
        let mainImage = await ProductImageTable.findOne({
          PRODUCT_ID: product._id,
          is_main: true,
        });

        // If no main image found, pick the first uploaded image
        if (!mainImage) {
          mainImage = await ProductImageTable.findOne({ PRODUCT_ID: product._id }).sort({
            _id: -1,
          });
        }

        return {
          _id: product._id,
          prod_id: product.prod_id,
          product_name: product.product_name,
          description: product.description,
          product_info: product.product_info || [],
          category: product.CAT_ID?.category_name || "Uncategorized",
          main_image: mainImage ? mainImage.image_path : null, // ✅ attach image
            date: product.date,
        };
      })
    );

    res.status(200).json({
      success: true,
      products: productsWithMainImage,
    });
  } catch (error) {
    console.error("❌ Error fetching products for userview:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching products",
    });
  }
});


/* ============================================================
   8. Get Products by Category Name for User View
============================================================ */
// ✅ USER-FACING: Fetch products by category name
router.get("/category/:categoryName", async (req, res) => {
  try {
    const { categoryName } = req.params;

    // Step 1️⃣: Fetch all products and populate category
    const products = await Product_table.find()
      .populate("CAT_ID", "category_name")
      .lean();

    // Step 2️⃣: Filter products that match the given category name
    const matchedProducts = products.filter(
      (p) =>
        p.CAT_ID?.category_name?.toLowerCase() ===
        categoryName.toLowerCase()
    );

    // Step 3️⃣: Attach main image like in /userview
    const productsWithImage = await Promise.all(
      matchedProducts.map(async (product) => {
        let mainImg =
          (await ProductImageTable.findOne({
            PRODUCT_ID: product._id,
            is_main: true,
          })) ||
          (await ProductImageTable.findOne({ PRODUCT_ID: product._id }));

        return {
          _id: product._id,
          prod_id: product.prod_id,
          product_name: product.product_name,
          description: product.description,
          category: product.CAT_ID?.category_name || "Uncategorized",
          main_image: mainImg ? mainImg.image_path : null,
        };
      })
    );

    res.json({
      success: true,
      category: categoryName,
      products: productsWithImage,
    });
  } catch (error) {
    console.error("❌ Error fetching category products:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error while fetching category products" });
  }
});



// router.get("/category/:categoryName", async (req, res) => {
//   try {
//     const { categoryName } = req.params;

//     // Fetch all products with category info
//     const products = await Product_table.find()
//       .populate("CAT_ID", "category_name")
//       .lean();

//     // Match category name
//     const matchedProducts = products.filter(
//       (p) =>
//         p.CAT_ID?.category_name?.toLowerCase() === categoryName.toLowerCase()
//     );

//     // Attach images + keep all required fields
//     const productsWithImage = await Promise.all(
//       matchedProducts.map(async (product) => {
//         const mainImg =
//           (await ProductImageTable.findOne({
//             PRODUCT_ID: product._id,
//             is_main: true,
//           })) ||
//           (await ProductImageTable.findOne({ PRODUCT_ID: product._id }));

//         return {
//           _id: product._id,
//           prod_id: product.prod_id,
//           product_name: product.product_name,
//           description: product.description,
//           product_info: product.product_info,
//           category: product.CAT_ID?.category_name,
//           date: product.date,  // 🔥 IMPORTANT
//           main_image: mainImg ? mainImg.image_path : null,
//         };
//       })
//     );

//     res.json({
//       success: true,
//       products: productsWithImage,
//     });
//   } catch (error) {
//     console.error("❌ Error fetching category products:", error);
//     res.status(500).json({
//       success: false,
//       message: "Server error while fetching category products",
//     });
//   }
// });
/* ============================================================
   7. Get Single Product Details for User View
============================================================ */


// ✅ USER-FACING: Fetch single product details by ID
// ✅ USER-FACING: Fetch single product details by ID
// ✅ USER-FACING: Fetch single product details by ID
router.get("/userview/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID format
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid MongoDB ID",
      });
    }

    // Step 1: Find product using MongoDB _id
    const product = await Product_table.findById(id)
      .populate("CAT_ID", "category_name")
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Step 2: Fetch all images for this product
    const images = await ProductImageTable.find({ PRODUCT_ID: product._id });

    const mainImg = images.find((img) => img.is_main);
    const otherImages = images.filter((img) => !img.is_main);

    const getImageUrl = (imagePath) => {
      if (!imagePath) return null;
      if (/^https?:\/\//i.test(imagePath)) return imagePath;
      return `${req.protocol}://${req.get("host")}/${imagePath.replace(/^\/+/, "")}`;
    };

    // Step 3: Build response object
    const productDetails = {
      _id: product._id,
      prod_id: product.prod_id,
      product_name: product.product_name,
      description: product.description,
      product_info: product.product_info || [],
      category: product.CAT_ID?.category_name || "Uncategorized",

      // Absolute URLs for images
      main_image: mainImg ? getImageUrl(mainImg.image_path) : null,
      gallery: otherImages.map((img) => getImageUrl(img.image_path)),
    };

    res.status(200).json({
      success: true,
      product: productDetails,
    });

  } catch (error) {
    console.error("❌ Error fetching product:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching product",
    });
  }
});





// // ✅ Then your single product route
// router.get("/:id", async (req, res) => {
//   try {
//     const product = await Product_table.findById(req.params.id);
//     res.json({ success: true, product });
//   } catch (error) {
//     console.error("❌ Error fetching product:", error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// });




// Get images of a product
router.get("/images/:productId", async (req, res) => {
  try {
    const images = await ProductImageTable.find({
      PRODUCT_ID: req.params.productId,
    });
    res.json({ success: true, images });
  } catch (error) {
    console.error("❌ Error fetching images:", error);
    res.status(500).json({ success: false, message: "Server error while fetching images" });
  }
});

// Set main image
router.put("/setMainImage/:imageId", async (req, res) => {
  try {
    const { imageId } = req.params;

    const image = await ProductImageTable.findById(imageId);
    if (!image) {
      return res.status(404).json({ success: false, message: "Image not found" });
    }

    await ProductImageTable.updateMany(
      { PRODUCT_ID: image.PRODUCT_ID },
      { $set: { is_main: false } }
    );

    image.is_main = true;
    await image.save();

    res.status(200).json({
      success: true,
      message: "Main image updated successfully",
      image,
    });
  } catch (error) {
    console.error("❌ Error setting main image:", error);
    res.status(500).json({ success: false, message: "Server error while setting main image" });
  }
});





/* ============================================================
   ✅ 1. Add Product ADMIN SIDE
============================================================ */
router.post("/add", async (req, res) => {
  try {
    const { prod_id, product_name, CAT_ID, description, product_info } = req.body;
    if (!prod_id || !product_name || !CAT_ID ) {
      return res.status(400).json({ success: false, message: "All required fields must be filled" });
    }


      // 🔥 Check if Product ID already exists
    const existingProduct = await Product_table.findOne({ prod_id });
    if (existingProduct) {
      return res.status(409).json({
        success: false,
        message: "Product ID already exists",
        code: "DUPLICATE_PROD_ID"
      });
    }


    const newProduct = new Product_table({
      prod_id,
      product_name,
      CAT_ID,
      description,
      product_info,
    });

    await newProduct.save();
    res.status(201).json({ success: true, message: "✅ Product added successfully", product: newProduct });
  } catch (error) {
    console.error("❌ Error adding product:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ============================================================
   ✅ 2. Upload Product Images
============================================================ */
router.post("/upload-images/:PRODUCT_ID", (req, res) => {
  const multipleUpload = uploadProductImage.array("images", 10);

  multipleUpload(req, res, async (err) => {
    if (err) {
      console.error("Multer error while uploading product images:", err);
      return res.status(400).json({ success: false, message: err.message || "File upload error", code: err.code || null });
    }

    try {
      const { PRODUCT_ID } = req.params;
      const { mainIndex } = req.body;
      const files = req.files;
      const uploadedImages = [];
      const insertedImages = [];

      if (!files || files.length === 0)
        return res.status(400).json({ success: false, message: "No images uploaded" });

      const product = await Product_table.findById(PRODUCT_ID);
      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      try {
        for (const [index, file] of files.entries()) {
          const image = await uploadImage(file, "fh-general-equipments/products");
          uploadedImages.push(image);
          const imageDoc = await ProductImageTable.create({
            PRODUCT_ID,
            image_path: image.secure_url,
            public_id: image.public_id,
            is_main: Number.parseInt(mainIndex, 10) === index,
          });
          insertedImages.push(imageDoc);
        }

        const selectedMainIndex = Number.parseInt(mainIndex, 10);
        if (Number.isInteger(selectedMainIndex) && selectedMainIndex >= 0 && selectedMainIndex < files.length) {
          await ProductImageTable.updateMany(
            { PRODUCT_ID, _id: { $nin: insertedImages.map((image) => image._id) } },
            { $set: { is_main: false } }
          );
        }
      } catch (error) {
        let recordsRemoved = true;
        if (insertedImages.length) {
          try {
            await ProductImageTable.deleteMany({
              _id: { $in: insertedImages.map((image) => image._id) },
            });
          } catch (rollbackError) {
            recordsRemoved = false;
            console.error("Unable to roll back product image records:", rollbackError);
          }
        }
        if (recordsRemoved) {
          await Promise.all(uploadedImages.map((image) =>
            deleteCloudinaryImageOrQueue(image.public_id).catch((cleanupError) => {
              console.error("Unable to clean up failed product upload:", cleanupError);
            })
          ));
        }
        throw error;
      }

      res.json({ success: true, message: "✅ Images uploaded successfully" });
    } catch (error) {
      console.error("❌ Error uploading product images:", error);
      res.status(error.status === 400 ? 400 : 500).json({
        success: false,
        message: error.status === 400 ? error.message : "Server error",
      });
    }
  });
});

/* ============================================================
   ✅ 3. View All Products
============================================================ */
router.get("/viewallProducts", async (req, res) => {
  try {
    const products = await Product_table.find()
      .populate("CAT_ID", "category_name")
      .sort({ date: -1 })
      .lean();

    for (let p of products) {
      const mainImg =
        (await ProductImageTable.findOne({ PRODUCT_ID: p._id, is_main: true })) ||
        (await ProductImageTable.findOne({ PRODUCT_ID: p._id }));

      p.main_image = mainImg ? mainImg.image_path : null;
    }

    res.json({ success: true, products });
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ============================================================
   ✅ 4. View Products by Category
============================================================ */
router.post("/view-by-category", async (req, res) => {
  try {
    const { CAT_ID } = req.body;

    if (!CAT_ID) {
      return res.status(400).json({ success: false, message: "Category ID is required" });
    }

    const products = await Product_table.find({ CAT_ID })
      .populate("CAT_ID", "category_name")
      .lean();

    for (let p of products) {
      const mainImg =
        (await ProductImageTable.findOne({ PRODUCT_ID: p._id, is_main: true })) ||
        (await ProductImageTable.findOne({ PRODUCT_ID: p._id }));

      p.main_image = mainImg ? mainImg.image_path : null;
    }

    res.json({ success: true, products });
  } catch (error) {
    console.error("❌ Error fetching products by category:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ============================================================
   ✅ 5. Search Products (by name or category)
============================================================ */
router.post("/searchProducts", async (req, res) => {
  try {
    const { product_name, CAT_ID } = req.body;

    // If category filter is applied
    let query = {};
    if (product_name) query.product_name = { $regex: product_name, $options: "i" };
    if (CAT_ID) query.CAT_ID = CAT_ID;

    const products = await Product_table.find(query)
      .populate("CAT_ID", "category_name")
      .lean();

    for (let p of products) {
      const mainImg =
        (await ProductImageTable.findOne({ PRODUCT_ID: p._id, is_main: true })) ||
        (await ProductImageTable.findOne({ PRODUCT_ID: p._id }));

      p.main_image = mainImg ? mainImg.image_path : null;
    }

    res.json({ success: true, products });
  } catch (error) {
    console.error("❌ Error searching products:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ============================================================
   ✅ 6. Delete Product
============================================================ */
/* ============================================================
   DELETE PRODUCT
============================================================ */
router.post("/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, message: "Product ID required" });
    }

    const product = await Product_table.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const images = await ProductImageTable.find({ PRODUCT_ID: id });
    await ProductImageTable.deleteMany({ PRODUCT_ID: id });

    await Product_table.findByIdAndDelete(id);

    for (const image of images) {
      if (!image.public_id) continue;
      const usage = await findImageUsage({
        publicId: image.public_id,
        secureUrl: image.image_path,
      });
      if (!hasImageUsage(usage)) {
        await deleteCloudinaryImageOrQueue(image.public_id);
      }
    }

    res.json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});



// ✅ Get Single Product by ID to edit
router.get("/:id", async (req, res) => {
  try {
    const product = await Product_table.findById(req.params.id)
      .populate("CAT_ID", "category_name")
      .lean();

    if (!product)
      return res.status(404).json({ success: false, message: "Product not found" });

    // Fetch associated images
    const images = await ProductImageTable.find({ PRODUCT_ID: req.params.id });
    product.images = images;

    res.json({ success: true, product });
  } catch (error) {
    console.error("❌ Error fetching product:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Update Product Details  edit
router.put("/update/:id", async (req, res) => {
  try {
    const { prod_id, product_name, CAT_ID, description, product_info } = req.body;

    const updatedProduct = await Product_table.findByIdAndUpdate(
      req.params.id,
      { prod_id, product_name, CAT_ID, description, product_info },
      { new: true }
    );

    if (!updatedProduct)
      return res.status(404).json({ success: false, message: "Product not found" });

    res.json({ success: true, message: "✅ Product updated successfully", product: updatedProduct });
  } catch (error) {
    console.error("❌ Error updating product:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});







// ✅ Fetch all active products for user view
router.get("/view", async (req, res) => {
  try {
    const products = await Product_table.find({ status: "active" }) // only active products
      .populate("CAT_ID", "category_name")
      .lean();

    const productsWithImage = await Promise.all(
      products.map(async (p) => {
        const mainImg =
          (await ProductImageTable.findOne({
            PRODUCT_ID: p._id,
            is_main: true,
          })) ||
          (await ProductImageTable.findOne({ PRODUCT_ID: p._id }));

        return {
          _id: p._id,
          name: p.name,
          description: p.description,
          category: p.CAT_ID?.category_name,
          main_image: mainImg?.filename || null,
        };
      })
    );

    res.json({ success: true, products: productsWithImage });
  } catch (error) {
    console.error("❌ Error fetching user products:", error);
    res
      .status(500)
      .json({ success: false, message: "Server Error fetching products" });
  }
});

router.use((err, req, res, next) => {
  if (isUploadError(err)) {
    return res.status(400).json({
      success: false,
      message: err.message,
      code: err.code || null,
    });
  }
  next(err);
});

export default router;
