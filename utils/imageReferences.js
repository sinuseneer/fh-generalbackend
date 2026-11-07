import Product_table from "../models/productModel.js";
import ProductImageTable from "../models/productImage.js";
import Category_table from "../models/categoryModel.js";
import Blog_table from "../models/postModel.js";
import BannerTable from "../models/Banner.js";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryExcludingId(query, exclude) {
  if (exclude?.model && exclude?.id) {
    return { ...query, _id: { $ne: exclude.id } };
  }
  return query;
}

export async function findImageUsage({ publicId, secureUrl, legacyPath, exclude }) {
  const alternatives = [];
  for (const value of [publicId, secureUrl, legacyPath]) {
    if (value) alternatives.push(new RegExp(escapeRegex(value), "i"));
  }

  const urlRegex = alternatives.length ? { $in: alternatives } : null;
  const productQuery = urlRegex
    ? { $or: [{ description: urlRegex }, { "product_info.value": urlRegex }] }
    : { _id: null };
  const productImageQuery = publicId || urlRegex
    ? { $or: [
      ...(publicId ? [{ public_id: publicId }] : []),
      ...(urlRegex ? [{ image_path: urlRegex }] : []),
    ] }
    : { _id: null };
  const categoryQuery = publicId || urlRegex
    ? { $or: [
      ...(publicId ? [{ category_image_public_id: publicId }] : []),
      ...(urlRegex ? [{ category_image: urlRegex }] : []),
    ] }
    : { _id: null };
  const postQuery = publicId || urlRegex
    ? { $or: [
      ...(publicId ? [{ image_public_id: publicId }] : []),
      ...(urlRegex ? [{ image: urlRegex }] : []),
    ] }
    : { _id: null };
  const bannerQuery = publicId || urlRegex
    ? { $or: [
      ...(publicId
        ? [{ image_public_id: publicId }, { mobileImage_public_id: publicId }]
        : []),
      ...(urlRegex ? [{ image: urlRegex }, { mobileImage: urlRegex }] : []),
    ] }
    : { _id: null };
  const [
    products,
    product_sub_images,
    categories,
    posts,
    banners,
  ] = await Promise.all([
    Product_table.find(queryExcludingId(productQuery, exclude?.model === Product_table ? exclude : null))
      .select("product_name prod_id"),
    ProductImageTable.find(queryExcludingId(productImageQuery, exclude?.model === ProductImageTable ? exclude : null))
      .select("PRODUCT_ID image_path public_id"),
    Category_table.find(queryExcludingId(categoryQuery, exclude?.model === Category_table ? exclude : null))
      .select("category_name"),
    Blog_table.find(queryExcludingId(postQuery, exclude?.model === Blog_table ? exclude : null))
      .select("title"),
    BannerTable.find(queryExcludingId(bannerQuery, exclude?.model === BannerTable ? exclude : null))
      .select("title"),
  ]);

  return { products, product_sub_images, categories, posts, banners };
}

export function hasImageUsage(usage) {
  return Object.values(usage).some((records) => records.length > 0);
}
