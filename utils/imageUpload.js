import multer from "multer";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/tiff",
  "image/webp",
]);

export function createImageUpload({ fileSize = 10 * 1024 * 1024 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize },
    fileFilter(req, file, callback) {
      if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
        const error = new Error("Unsupported image file type");
        error.status = 400;
        return callback(error);
      }

      callback(null, true);
    },
  });
}

export function isUploadError(error) {
  return error instanceof multer.MulterError || error.status === 400;
}
