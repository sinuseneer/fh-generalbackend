import mongoose from "mongoose";

const productImageSchema = new mongoose.Schema({
  PRODUCT_ID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "product_table",
    required: true
  },
  image_path: { type: String, required: true },
  public_id: { type: String, default: null },
  is_main: { type: Boolean, default: false },
});

const ProductImageTable = mongoose.model("product_sub_table", productImageSchema);
export default ProductImageTable;
