import express from "express";
import BannerTable from "../models/Banner.js";
import { createImageUpload, isUploadError } from "../utils/imageUpload.js";
import {
  deleteCloudinaryImageOrQueue,
  uploadImage,
} from "../utils/cloudinaryImages.js";
import { findImageUsage, hasImageUsage } from "../utils/imageReferences.js";

const router = express.Router();
const upload = createImageUpload({ fileSize: 10 * 1024 * 1024 });
const bannerFields = upload.fields([
  { name: "desktopImage", maxCount: 1 },
  { name: "mobileImage", maxCount: 1 },
]);

// Maximum active banners allowed on frontend
const MAX_ACTIVE = 6;

// =================================================
//            CREATE BANNER (desktop + mobile)
// =================================================
router.post("/", bannerFields, async (req, res) => {
  const uploadedImages = [];
  let saved = false;
  try {
    if (!req.files?.desktopImage?.[0]) {
      return res.status(400).json({ message: "Desktop image is required" });
    }

    const desktop = await uploadImage(req.files.desktopImage[0], "fh-general-equipments/banners");
    uploadedImages.push(desktop);
    const mobile = req.files.mobileImage?.[0]
      ? await uploadImage(req.files.mobileImage[0], "fh-general-equipments/banners")
      : null;
    if (mobile) uploadedImages.push(mobile);

    const last = await BannerTable.findOne().sort({ order: -1 }).lean();
    const nextOrder = last ? last.order + 1 : 0;
    const banner = new BannerTable({
      title: req.body.title || "",
      subtitle: req.body.subtitle || "",
      image: desktop.secure_url,
      image_public_id: desktop.public_id,
      mobileImage: mobile?.secure_url || null,
      mobileImage_public_id: mobile?.public_id || null,
      textMode: req.body.textMode === "light" ? "light" : "dark",
      active: false,
      order: nextOrder,
    });

    await banner.save();
    saved = true;
    return res.status(201).json({ success: true, banner });
  } catch (error) {
    console.error("Upload ERROR:", error);
    if (!saved) {
      await Promise.all(uploadedImages.map((image) =>
        deleteCloudinaryImageOrQueue(image.public_id).catch((cleanupError) => {
          console.error("Unable to clean up failed banner upload:", cleanupError);
        })
      ));
    }
    return res.status(error.status === 400 ? 400 : 500).json({ message: error.message });
  }
});

// =================================================
//                     GET ALL BANNERS
// =================================================
router.get("/", async (req, res) => {
  try {
    const banners = await BannerTable.find().sort({ order: 1 });
    res.json(banners);
  } catch (error) {
    console.error("GET /banners ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// =================================================
//               GET ACTIVE BANNERS (LIMITED)
// =================================================
router.get("/active", async (req, res) => {
  try {
    const banners = await BannerTable.find({ active: true })
      .sort({ order: 1 })
      .limit(MAX_ACTIVE)
      .select("_id title subtitle image mobileImage textMode order active");

    res.json(banners);
  } catch (error) {
    console.error("GET /active ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// =================================================
//          ACTIVATE (MAX 6 active allowed)
// =================================================
router.put("/:id/activate", async (req, res) => {
  try {
    const activeCount = await BannerTable.countDocuments({ active: true });

    if (activeCount >= MAX_ACTIVE) {
      return res.status(400).json({
        message: `Only ${MAX_ACTIVE} banners can be active at a time`,
      });
    }

    const banner = await BannerTable.findByIdAndUpdate(
      req.params.id,
      { active: true },
      { new: true }
    );

    if (!banner) return res.status(404).json({ message: "Banner not found" });

    res.json(banner);
  } catch (error) {
    console.error("ACTIVATE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// =================================================
//                   DEACTIVATE
// =================================================
router.put("/:id/deactivate", async (req, res) => {
  try {
    const banner = await BannerTable.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { new: true }
    );

    if (!banner) return res.status(404).json({ message: "Banner not found" });

    res.json(banner);
  } catch (error) {
    console.error("DEACTIVATE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// =================================================
//               REORDER BANNERS
// =================================================
router.put("/reorder", async (req, res) => {
  const { order } = req.body; // array of IDs

  if (!Array.isArray(order)) {
    return res.status(400).json({ message: "Order must be an array" });
  }

  try {
    const bulkOps = order.map((id, idx) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { order: idx } },
      },
    }));

    await BannerTable.bulkWrite(bulkOps);

    res.json({ success: true, message: "Order updated" });
  } catch (error) {
    console.error("REORDER ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// =================================================
//           UPDATE BANNER (TEXT + IMAGES)
//             replace supplied images only
// =================================================
router.put("/:id", bannerFields, async (req, res) => {
  const uploadedImages = [];
  let saved = false;
  try {
    const banner = await BannerTable.findById(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    const oldImages = [];
    if (req.files?.desktopImage?.[0]) {
      oldImages.push({
        publicId: banner.image_public_id,
        secureUrl: banner.image,
      });
      const image = await uploadImage(req.files.desktopImage[0], "fh-general-equipments/banners");
      uploadedImages.push(image);
      banner.image = image.secure_url;
      banner.image_public_id = image.public_id;
    }

    if (req.files?.mobileImage?.[0]) {
      oldImages.push({
        publicId: banner.mobileImage_public_id,
        secureUrl: banner.mobileImage,
      });
      const image = await uploadImage(req.files.mobileImage[0], "fh-general-equipments/banners");
      uploadedImages.push(image);
      banner.mobileImage = image.secure_url;
      banner.mobileImage_public_id = image.public_id;
    }

    banner.title = req.body.title ?? banner.title;
    banner.subtitle = req.body.subtitle ?? banner.subtitle;
    banner.textMode = req.body.textMode ?? banner.textMode;

    await banner.save();
    saved = true;

    for (const oldImage of oldImages) {
      if (!oldImage.publicId) continue;
      const usage = await findImageUsage({
        publicId: oldImage.publicId,
        secureUrl: oldImage.secureUrl,
      });
      if (!hasImageUsage(usage)) {
        await deleteCloudinaryImageOrQueue(oldImage.publicId);
      }
    }

    return res.json({ success: true, banner });
  } catch (error) {
    console.error("UPDATE ERROR:", error);
    if (!saved) {
      await Promise.all(uploadedImages.map((image) =>
        deleteCloudinaryImageOrQueue(image.public_id).catch((cleanupError) => {
          console.error("Unable to clean up failed banner replacement:", cleanupError);
        })
      ));
    }
    return res.status(error.status === 400 ? 400 : 500).json({ message: error.message });
  }
});

// =================================================
//               DELETE BANNER AND CLOUDINARY IMAGES
// =================================================
router.delete("/:id", async (req, res) => {
  try {
    const banner = await BannerTable.findById(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    const oldImageUsage = await Promise.all([
      [banner.image_public_id, banner.image],
      [banner.mobileImage_public_id, banner.mobileImage],
    ].map(([publicId, secureUrl]) => publicId
      ? findImageUsage({
        publicId,
        secureUrl,
        exclude: { model: BannerTable, id: banner._id },
      })
      : null));

    await banner.deleteOne();

    const oldImages = [
      [banner.image_public_id, oldImageUsage[0]],
      [banner.mobileImage_public_id, oldImageUsage[1]],
    ];
    for (const [publicId, usage] of oldImages) {
      if (publicId && !hasImageUsage(usage)) {
        await deleteCloudinaryImageOrQueue(publicId);
      }
    }

    res.json({
      message: "Banner deleted successfully",
    });
  } catch (error) {
    console.error("DELETE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

router.use((err, req, res, next) => {
  if (isUploadError(err)) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
});

export default router;
