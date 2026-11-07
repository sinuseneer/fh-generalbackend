import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";
import Product from "../models/productModel.js";
import ProductImage from "../models/productImage.js";
import Category from "../models/categoryModel.js";
import Blog from "../models/postModel.js";
import Banner from "../models/Banner.js";
import MediaMetadata from "../models/mediaMetadataModel.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VALIDATE_MAPPING_ONLY = process.argv.includes("--validate-mapping-only");
const CLOUDINARY_CLOUD_NAME = "qmw1959p";
const mappingPath = process.argv.slice(2).find((argument) => !argument.startsWith("--")) ||
  process.env.IMAGE_MIGRATION_MAPPING;

function normalizePath(value) {
  let pathname = value.trim();
  if (/^https?:\/\//i.test(pathname)) {
    pathname = new URL(pathname).pathname;
  }
  let normalized = pathname.replace(/\\/g, "/").replace(/^\/+/, "");
  normalized = normalized.replace(/^var\/www\//i, "");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    throw new Error(`Invalid percent-encoding in legacy path: ${value}`);
  }
  return normalized.replace(/^\/+/, "");
}

function parseMappingUrl(value) {
  const mappedUrl = typeof value === "string"
    ? value
    : value?.secureUrl || value?.secure_url || value?.url || value?.cloudinary_url;
  if (!mappedUrl) throw new Error("Mapping entry must contain a Cloudinary URL");

  const url = new URL(mappedUrl);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "res.cloudinary.com") {
    throw new Error("Mapping URL must use the secure res.cloudinary.com hostname");
  }

  let segments;
  try {
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new Error("Cloudinary URL contains invalid percent-encoding");
  }
  if (segments[0] !== CLOUDINARY_CLOUD_NAME ||
      segments[1] !== "image" ||
      segments[2] !== "upload") {
    throw new Error(`Mapping URL must belong to Cloudinary cloud ${CLOUDINARY_CLOUD_NAME}`);
  }

  const versionIndex = segments.findIndex((segment, index) =>
    index > 2 && /^v\d+$/.test(segment)
  );
  if (versionIndex === -1 || versionIndex === segments.length - 1) {
    throw new Error("Cloudinary URL is missing an upload version or public ID");
  }

  const assetPath = segments.slice(versionIndex + 1).join("/");
  const extension = assetPath.match(/\.(avif|bmp|gif|jpe?g|png|svg|tiff|webp)$/i)?.[1];
  const publicId = assetPath.replace(/\.(avif|bmp|gif|jpe?g|png|svg|tiff|webp)$/i, "");
  if (!/^fh-general-equipments\/(categories|banners|posts|products)\//.test(publicId)) {
    throw new Error("Mapped public IDs must belong to an application image folder");
  }
  const suppliedPublicId = typeof value === "object"
    ? value.publicId || value.public_id
    : null;
  if (suppliedPublicId && suppliedPublicId !== publicId) {
    throw new Error("Mapping public_id does not match the Cloudinary URL");
  }

  return {
    secure_url: url.toString(),
    public_id: publicId,
    format: extension?.toLowerCase() ||
      (typeof value === "object" ? String(value.format || "unknown").toLowerCase() : "unknown"),
    bytes: typeof value === "object" ? value.bytes : undefined,
  };
}

function loadMappings(file) {
  if (!file) throw new Error("Provide the copied migration-mapping.json path");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Migration mapping must be a JSON object keyed by old image path");
  }

  const mappings = new Map();
  for (const [oldPath, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Mapping entry must be an object: ${oldPath}`);
    }
    if (value.status !== "uploaded") {
      throw new Error(`Mapping entry is not uploaded: ${oldPath}`);
    }
    const sourcePath = value.originalPath || oldPath;
    const key = normalizePath(sourcePath);
    if (!key.startsWith("uploads/")) {
      throw new Error(`Mapping originalPath is not an uploads path: ${sourcePath}`);
    }
    const mapped = parseMappingUrl(value);
    const suppliedPublicId = value.publicId || value.public_id;
    if (!suppliedPublicId) {
      throw new Error(`Mapping entry must include publicId: ${oldPath}`);
    }
    const existing = mappings.get(key);
    if (existing && existing.secure_url !== mapped.secure_url) {
      throw new Error(`Conflicting Cloudinary mappings for ${sourcePath}`);
    }
    mappings.set(key, mapped);
  }
  if (!mappings.size) throw new Error("Migration mapping is empty");
  return mappings;
}

async function validateRemoteMappings(mappings) {
  const entries = [...mappings.entries()];
  const resourcesByPublicId = new Map();
  for (let index = 0; index < entries.length; index += 5) {
    await Promise.all(entries.slice(index, index + 5).map(async ([legacyPath, mapped]) => {
      const resource = await cloudinary.api.resource(mapped.public_id, {
        resource_type: "image",
        type: "upload",
      });
      if (!resource.secure_url || !resource.public_id ||
          resource.public_id !== mapped.public_id) {
        throw new Error(`Cloudinary asset validation failed for ${legacyPath}`);
      }
      if (mapped.format !== "unknown" &&
          String(resource.format).toLowerCase() !== mapped.format) {
        throw new Error(`Cloudinary format validation failed for ${legacyPath}`);
      }
      resourcesByPublicId.set(mapped.public_id, resource);
    }));
  }
  return resourcesByPublicId;
}

function mapDirectValue(value, mappings, missing) {
  if (typeof value !== "string" ||
      !(/^(?:https?:\/\/[^/]+)?\/?(?:var\/www\/)?uploads\//i.test(value))) {
    return value;
  }
  const key = normalizePath(value);
  const mapped = mappings.get(key);
  if (!mapped) missing.add(value);
  return mapped ? mapped.secure_url : value;
}

function mapTextValue(value, mappings, missing) {
  if (typeof value !== "string") return value;
  return value.replace(
    /https?:\/\/[^"'\\\s<>]+?\/uploads\/[^"'\\\s<>),]+|\/?(?:var\/www\/)?uploads\/[^"'\\\s<>),]+/gi,
    (legacyPath) => {
    const mapped = mappings.get(normalizePath(legacyPath));
    if (!mapped) {
      missing.add(legacyPath);
      return legacyPath;
    }
    return mapped.secure_url;
  });
}

export {
  CLOUDINARY_CLOUD_NAME,
  loadMappings,
  mapDirectValue,
  mapTextValue,
  normalizePath,
  parseMappingUrl,
  validateRemoteMappings,
};

async function updateDocuments(Model, docs, fieldUpdates, dryRunCounts) {
  const operations = [];
  for (const document of docs) {
    const update = fieldUpdates(document);
    if (Object.keys(update).length) {
      dryRunCounts[Model.modelName] = (dryRunCounts[Model.modelName] || 0) + 1;
      operations.push({
        updateOne: {
          filter: { _id: document._id },
          update: { $set: update },
        },
      });
    }
  }
  return operations;
}

async function run() {
  const mappings = loadMappings(mappingPath);
  if (VALIDATE_MAPPING_ONLY) {
    console.log(`Validated ${mappings.size} local Cloudinary mappings. No network or database connection was made.`);
    return;
  }
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");

  const cloudinaryResources = await validateRemoteMappings(mappings);
  await mongoose.connect(process.env.MONGO_URI);
  const missing = new Set();
  const counts = {};
  const categories = await Category.find({});
  const banners = await Banner.find({});
  const blogs = await Blog.find({});
  const productImages = await ProductImage.find({});
  const products = await Product.find({});
  const mediaMetadataOperations = [];

  if (process.env.LEGACY_MEDIA_METADATA_DIR) {
    for (const folder of ["products", "posts", "banners", "categories"]) {
      const metadataPath = path.join(process.env.LEGACY_MEDIA_METADATA_DIR, folder, "media.meta.json");
      if (!fs.existsSync(metadataPath)) continue;
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      for (const [filename, value] of Object.entries(metadata)) {
        const mapped = mappings.get(normalizePath(`uploads/${folder}/${filename}`));
        if (!mapped) continue;
        const setMetadata = {
          public_id: mapped.public_id,
          folder,
          name: mapped.public_id.split("/").pop(),
          secure_url: mapped.secure_url,
          format: mapped.format,
          favorite: value.favorite === true,
          title: value.title || filename,
          alt: value.alt || "",
          caption: value.caption || "",
          description: value.description || "",
        };
        const resource = cloudinaryResources.get(mapped.public_id);
        const bytes = value.bytes ?? mapped.bytes ?? resource?.bytes;
        const width = value.width ?? resource?.width;
        const height = value.height ?? resource?.height;
        if (bytes !== undefined) setMetadata.bytes = bytes;
        if (width !== undefined) setMetadata.width = width;
        if (height !== undefined) setMetadata.height = height;
        mediaMetadataOperations.push({
          updateOne: {
            filter: { public_id: mapped.public_id },
            update: {
              $set: setMetadata,
            },
            upsert: true,
          },
        });
      }
    }
  }

  const collections = [
    [Category, categories, (doc) => {
      const url = mapDirectValue(doc.category_image, mappings, missing);
      if (url === doc.category_image) return {};
      const mapped = [...mappings.values()].find((item) => item.secure_url === url);
      return { category_image: url, category_image_public_id: mapped.public_id };
    }],
    [Banner, banners, (doc) => {
      const update = {};
      for (const [urlField, idField] of [
        ["image", "image_public_id"],
        ["mobileImage", "mobileImage_public_id"],
      ]) {
        const url = mapDirectValue(doc[urlField], mappings, missing);
        if (url !== doc[urlField]) {
          const mapped = [...mappings.values()].find((item) => item.secure_url === url);
          update[urlField] = url;
          update[idField] = mapped.public_id;
        }
      }
      return update;
    }],
    [Blog, blogs, (doc) => {
      const update = {};
      const url = mapDirectValue(doc.image, mappings, missing);
      if (url !== doc.image) {
        const mapped = [...mappings.values()].find((item) => item.secure_url === url);
        update.image = url;
        update.image_public_id = mapped.public_id;
      }
      const longDescription = mapTextValue(doc.longDescription, mappings, missing);
      if (longDescription !== doc.longDescription) {
        update.longDescription = longDescription;
      }
      return update;
    }],
    [ProductImage, productImages, (doc) => {
      const url = mapDirectValue(doc.image_path, mappings, missing);
      if (url === doc.image_path) return {};
      const mapped = [...mappings.values()].find((item) => item.secure_url === url);
      return { image_path: url, public_id: mapped.public_id };
    }],
  ];

  const operationsByModel = [];
  for (const [Model, documents, updater] of collections) {
    operationsByModel.push([
      Model,
      await updateDocuments(Model, documents, updater, counts),
    ]);
  }

  const productOperations = [];
  for (const product of products) {
    const update = {};
    const description = mapTextValue(product.description, mappings, missing);
    if (description !== product.description) update.description = description;
    const productInfo = (product.product_info || []).map((item) => {
      const key = mapTextValue(item.key, mappings, missing);
      const value = mapTextValue(item.value, mappings, missing);
      if (key !== item.key || value !== item.value) update.product_info = true;
      return { ...item.toObject?.() ?? item, key, value };
    });
    if (update.product_info) update.product_info = productInfo;
    if (Object.keys(update).length) {
      counts[Product.modelName] = (counts[Product.modelName] || 0) + 1;
      productOperations.push({
        updateOne: { filter: { _id: product._id }, update: { $set: update } },
      });
    }
  }

  console.log(`Validated ${mappings.size} Cloudinary mappings.`);
  if (mediaMetadataOperations.length) {
    counts.MediaMetadata = mediaMetadataOperations.length;
  }
  console.log("Documents requiring updates:", counts);
  if (missing.size) {
    console.error(`Found ${missing.size} legacy paths with no mapping:`);
    for (const value of missing) console.error(`- ${value}`);
    throw new Error("Add valid mappings for all referenced legacy paths before applying");
  }

  if (!APPLY) {
    console.log("Dry run only. No database changes were made. Add --apply after reviewing the counts.");
    return;
  }

  const backupPath = process.env.MONGO_BACKUP_PATH;
  if (!backupPath) throw new Error("Set MONGO_BACKUP_PATH before using --apply");
  const resolvedBackupPath = path.resolve(backupPath);
  if (fs.existsSync(resolvedBackupPath)) {
    throw new Error(`Refusing to overwrite existing backup: ${resolvedBackupPath}`);
  }
  fs.mkdirSync(path.dirname(resolvedBackupPath), { recursive: true });
 const backup = spawnSync("mongodump", [
  `--uri=${process.env.MONGO_URI}`,
  "--db=FHgeneralEquipments",
  `--archive=${resolvedBackupPath}`,
  "--gzip",
], { stdio: "inherit" });
  if (backup.error || backup.status !== 0) {
    throw backup.error || new Error("mongodump failed; database migration was not applied");
  }
  console.log(`MongoDB backup completed: ${resolvedBackupPath}`);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const [Model, operations] of operationsByModel) {
        if (operations.length) {
          await Model.bulkWrite(operations, { ordered: true, session });
        }
      }
      if (productOperations.length) {
        await Product.bulkWrite(productOperations, { ordered: true, session });
      }
      if (mediaMetadataOperations.length) {
        await MediaMetadata.bulkWrite(mediaMetadataOperations, { ordered: true, session });
      }
    });
  } finally {
    await session.endSession();
  }
  console.log("Cloudinary image references updated. Verify the application before removing legacy files.");
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run()
    .catch((error) => {
      console.error("Cloudinary reference migration failed:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState) await mongoose.disconnect();
    });
}
