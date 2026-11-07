import { randomUUID } from "crypto";
import cloudinary from "../config/cloudinary.js";
import CloudinaryCleanup from "../models/cloudinaryCleanupModel.js";
import processImage from "./processImage.js";

export const CLOUDINARY_ROOT = "fh-general-equipments";
const APPLICATION_FOLDERS = new Set(["banners", "categories", "posts", "products"]);

export function isApplicationPublicId(publicId) {
  if (typeof publicId !== "string") return false;
  const [root, folder, ...segments] = publicId.split("/");
  return root === CLOUDINARY_ROOT &&
    APPLICATION_FOLDERS.has(folder) &&
    segments.length > 0 &&
    !publicId.split("/").some((segment) => segment === "." || segment === "..");
}

export function uploadImage(file, folder) {
  return uploadWebpBuffer(file?.buffer, folder);
}

export async function uploadWebpBuffer(inputBuffer, folder) {
  if (!folder || !folder.startsWith(`${CLOUDINARY_ROOT}/`)) {
    throw new TypeError("A valid application Cloudinary folder is required");
  }

  const buffer = await processImage(inputBuffer);
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        asset_folder: folder,
        format: "webp",
        public_id: `${folder}/${randomUUID()}`,
        resource_type: "image",
        overwrite: false,
      },
      (error, uploaded) => {
        if (error) return reject(error);
        resolve(uploaded);
      }
    );

    stream.end(buffer);
  });

  if (result.format !== "webp" || !result.secure_url || !result.public_id) {
    if (result.public_id) {
      await cloudinary.uploader.destroy(result.public_id, { resource_type: "image" });
    }
    throw new Error("Cloudinary did not confirm a WebP image upload");
  }

  return {
    secure_url: result.secure_url,
    public_id: result.public_id,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
  };
}

export async function deleteCloudinaryImage(publicId) {
  if (!isApplicationPublicId(publicId)) {
    throw new TypeError("Refusing to delete an image outside the application folder");
  }

  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    invalidate: true,
  });

  if (result.result !== "ok" && result.result !== "not found") {
    throw new Error(`Cloudinary deletion was not confirmed for ${publicId}`);
  }

  return result;
}

export async function deleteCloudinaryImageOrQueue(publicId) {
  if (!isApplicationPublicId(publicId)) {
    throw new TypeError("Refusing to queue deletion outside the application folder");
  }

  try {
    await deleteCloudinaryImage(publicId);
  } catch (error) {
    const job = await CloudinaryCleanup.findOneAndUpdate(
      { public_id: publicId, completed_at: null },
      {
        $setOnInsert: {
          public_id: publicId,
          attempts: 0,
          next_attempt_at: new Date(Date.now() + 60_000),
          last_error: error.message,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.error(`Queued Cloudinary cleanup for ${publicId}:`, error.message);
    return { queued: true, jobId: job._id };
  }

  return { queued: false };
}

export async function retryCloudinaryCleanup() {
  const jobs = await CloudinaryCleanup.find({
    completed_at: null,
    next_attempt_at: { $lte: new Date() },
  }).limit(25);

  for (const job of jobs) {
    try {
      await deleteCloudinaryImage(job.public_id);
      await job.deleteOne();
    } catch (error) {
      const attempts = job.attempts + 1;
      const delay = Math.min(60 * 60 * 1000, 60_000 * (2 ** Math.min(attempts, 6)));
      job.attempts = attempts;
      job.last_error = error.message;
      job.next_attempt_at = new Date(Date.now() + delay);
      await job.save();
      console.error(`Cloudinary cleanup retry ${attempts} failed for ${job.public_id}:`, error.message);
    }
  }
}

export async function listApplicationImages(folder) {
  const prefix = folder
    ? `${CLOUDINARY_ROOT}/${folder}`
    : `${CLOUDINARY_ROOT}/`;
  const resources = [];
  let nextCursor;

  do {
    const page = await cloudinary.api.resources({
      type: "upload",
      resource_type: "image",
      prefix,
      max_results: 500,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    });
    resources.push(...page.resources.filter((resource) =>
      isApplicationPublicId(resource.public_id) &&
      (!folder || resource.public_id.startsWith(`${prefix}/`))
    ));
    nextCursor = page.next_cursor;
  } while (nextCursor);

  return resources;
}

export { cloudinary };
