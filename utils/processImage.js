import sharp from "sharp";

const MAX_DIMENSION = 2000;

export default async function processImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new TypeError("An image buffer is required");
    error.status = 400;
    throw error;
  }

  try {
    return await sharp(buffer, { failOn: "error" })
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (cause) {
    const error = new Error("Invalid or unsupported image data", { cause });
    error.status = 400;
    throw error;
  }
}
