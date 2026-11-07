import express from "express";
import mongoose from "mongoose";
import corsMiddleware from "./middleware/corsMiddleware.js";

import adminRoutes from "./routes/adminRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import bannerRoutes from "./routes/bannerRoutes.js"
import postRoutes from "./routes/postRoutes.js"
import mediaRoutes from "./routes/mediaRoutes.js";
import contactRoute from "./routes/contactRoute.js";

const app = express();

// ✅ Middleware
app.use(corsMiddleware);

// ✅ Handle preflight properly
// app.options("*", cors());


// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));


// ✅ MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected successfully");
    const { retryCloudinaryCleanup } = await import("./utils/cloudinaryImages.js");
    const cleanupTimer = setInterval(() => {
      retryCloudinaryCleanup().catch((error) => {
        console.error("Cloudinary cleanup retry worker failed:", error);
      });
    }, 60_000);
    cleanupTimer.unref();
  })
  .catch((err) => console.log("❌ MongoDB connection error:", err));
// import connectDB from "./db.js";
// connectDB();



app.get("/", (req, res) => {
  res.send("🚀 Backend server running...");
});

// ✅ Routes
app.use("/api/admin", adminRoutes);
app.use("/api/category", categoryRoutes);
app.use("/api/product", productRoutes); // <-- make sure it's plural!
app.use("/api/banners", bannerRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/contact", contactRoute);


// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`⚡ Server running on port ${PORT}`));
