import express from "express";
import { createImageUpload, isUploadError } from "../utils/imageUpload.js";
import {
  deleteCloudinaryImageOrQueue,
  listApplicationImages,
  uploadImage,
} from "../utils/cloudinaryImages.js";
import { findImageUsage, hasImageUsage } from "../utils/imageReferences.js";
import MediaMetadata from "../models/mediaMetadataModel.js";

const router = express.Router();
const upload = createImageUpload({ fileSize: 10 * 1024 * 1024 });
const FOLDERS = ["products", "posts", "banners", "categories"];

function getFolder(value) {
  if (!FOLDERS.includes(value)) {
    throw new Error("Invalid media category");
  }
  return value;
}

function getLegacyPath(folder, name) {
  return `uploads/${folder}/${name}`;
}

function getAssetName(publicId) {
  return publicId.split("/").pop();
}

async function syncFolderMetadata(folder) {
  const resources = await listApplicationImages(folder);
  if (resources.length) {
    await MediaMetadata.bulkWrite(resources.map((resource) => {
      const name = getAssetName(resource.public_id);
      return {
        updateOne: {
          filter: { public_id: resource.public_id },
          update: {
            $setOnInsert: {
              folder,
              name,
              title: name,
            },
            $set: {
              secure_url: resource.secure_url,
              format: resource.format,
              bytes: resource.bytes,
              width: resource.width,
              height: resource.height,
            },
          },
          upsert: true,
        },
      };
    }));
  }
  return resources;
}

async function resolveMedia(folder, name) {
  return MediaMetadata.findOne({ folder, name });
}

router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 40));
    const search = String(req.query.search || "").toLowerCase();
    const category = String(req.query.category || "all");
    const folders = category === "all" ? FOLDERS : [getFolder(category)];

    const assetsByFolder = await Promise.all(folders.map(async (folder) => ({
      folder,
      resources: await syncFolderMetadata(folder),
    })));
    let entries = assetsByFolder.flatMap(({ folder, resources }) =>
      resources.map((resource) => ({
        folder,
        name: getAssetName(resource.public_id),
        public_id: resource.public_id,
        url: resource.secure_url,
        resource,
      }))
    );

    const metadata = await MediaMetadata.find({
      public_id: { $in: entries.map((entry) => entry.public_id) },
    }).lean();
    const metadataById = new Map(metadata.map((item) => [item.public_id, item]));

    if (search) {
      entries = entries.filter((entry) => {
        const meta = metadataById.get(entry.public_id);
        return [
          entry.name,
          meta?.title,
          meta?.alt,
          meta?.caption,
          meta?.description,
        ].some((value) => String(value || "").toLowerCase().includes(search));
      });
    }

    entries.sort((a, b) => {
      const favoriteDelta = Number(Boolean(metadataById.get(b.public_id)?.favorite)) -
        Number(Boolean(metadataById.get(a.public_id)?.favorite));
      return favoriteDelta || new Date(b.resource.created_at) - new Date(a.resource.created_at);
    });

    const total = entries.length;
    const items = entries.slice((page - 1) * limit, page * limit).map((entry) => {
      const meta = metadataById.get(entry.public_id);
      return {
        name: entry.name,
        folder: entry.folder,
        url: entry.url,
        downloadUrl: `/api/media/download/${encodeURIComponent(entry.name)}?cat=${encodeURIComponent(entry.folder)}`,
        meta: {
          title: meta?.title || entry.name,
          alt: meta?.alt || "",
          caption: meta?.caption || "",
          description: meta?.description || "",
          favorite: Boolean(meta?.favorite),
        },
      };
    });

    return res.json({ total, items, page, limit });
  } catch (error) {
    console.error("Error loading media:", error);
    return res.status(error.message === "Invalid media category" ? 400 : 500)
      .json({ message: error.message === "Invalid media category" ? error.message : "Error loading media" });
  }
});

router.post("/upload", upload.array("media", 10), async (req, res) => {
  const uploaded = [];
  try {
    const folder = getFolder(String(req.query.cat || "products"));
    if (!req.files?.length) {
      return res.status(400).json({ message: "No images uploaded" });
    }

    for (const file of req.files) {
      uploaded.push(await uploadImage(file, `fh-general-equipments/${folder}`));
    }

    await MediaMetadata.bulkWrite(uploaded.map((image) => {
      const name = getAssetName(image.public_id);
      return {
        updateOne: {
          filter: { public_id: image.public_id },
          update: {
            $setOnInsert: {
              public_id: image.public_id,
              folder,
              name,
              secure_url: image.secure_url,
              format: image.format,
              bytes: image.bytes,
              width: image.width,
              height: image.height,
              title: name,
            },
          },
          upsert: true,
        },
      };
    }));

    return res.json({
      ok: true,
      uploaded: uploaded.map((image) => getAssetName(image.public_id)),
    });
  } catch (error) {
    console.error("Media upload failed:", error);
    await Promise.all(uploaded.map((image) =>
      deleteCloudinaryImageOrQueue(image.public_id).catch((cleanupError) => {
        console.error("Unable to clean up failed media upload:", cleanupError);
      })
    ));
    const badRequest = error.message === "Invalid media category" || error.status === 400;
    return res.status(badRequest ? 400 : 500)
      .json({ message: badRequest ? error.message : "Upload failed" });
  }
});

router.post("/favorite/:name", express.json(), async (req, res) => {
  try {
    const folder = getFolder(String(req.query.cat || ""));
    const media = await resolveMedia(folder, req.params.name);
    if (!media) return res.status(404).json({ message: "Media not found" });

    media.favorite = req.body.favorite === true;
    for (const field of ["title", "alt", "caption", "description"]) {
      if (typeof req.body[field] === "string") media[field] = req.body[field];
    }
    await media.save();
    return res.json({ ok: true, favorite: media.favorite });
  } catch (error) {
    return res.status(error.message === "Invalid media category" ? 400 : 500)
      .json({ message: error.message });
  }
});

router.get("/download/:name", async (req, res) => {
  try {
    const folder = getFolder(String(req.query.cat || ""));
    const media = await resolveMedia(folder, req.params.name);
    if (!media) return res.status(404).send("File not found");
    return res.redirect(media.secure_url);
  } catch (error) {
    return res.status(error.message === "Invalid media category" ? 400 : 500)
      .json({ message: error.message });
  }
});

router.get("/usage/:folder/:file", async (req, res) => {
  try {
    const folder = getFolder(req.params.folder);
    const file = req.params.file;
    const media = await resolveMedia(folder, file);
    const usage = await findImageUsage({
      publicId: media?.public_id,
      secureUrl: media?.secure_url,
      legacyPath: getLegacyPath(folder, file),
    });
    return res.json({ ...usage, inUse: hasImageUsage(usage) ? 1 : 0 });
  } catch (error) {
    console.error("Media usage check failed:", error);
    return res.status(error.message === "Invalid media category" ? 400 : 500)
      .json({ message: "Usage check failed" });
  }
});

router.delete("/:name", async (req, res) => {
  try {
    const folder = getFolder(String(req.query.cat || ""));
    const media = await resolveMedia(folder, req.params.name);
    if (!media) return res.status(404).json({ message: "Media not found" });

    const usage = await findImageUsage({
      publicId: media.public_id,
      secureUrl: media.secure_url,
      legacyPath: getLegacyPath(folder, media.name),
    });
    if (hasImageUsage(usage)) {
      return res.status(400).json({
        message: "Cannot delete: image is in use",
        usage: { ...usage, inUse: 1 },
      });
    }

    const cleanup = await deleteCloudinaryImageOrQueue(media.public_id);
    await media.deleteOne();
    return res.json({
      ok: true,
      message: "Deleted",
      ...(cleanup.queued ? { cleanupPending: true } : {}),
    });
  } catch (error) {
    console.error("Media deletion failed:", error);
    return res.status(error.message === "Invalid media category" ? 400 : 500)
      .json({ message: "Media deletion failed" });
  }
});

router.use((err, req, res, next) => {
  if (isUploadError(err)) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
});

export default router;
