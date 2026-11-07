import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const clientUrls = (process.env.CLIENT_URL || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid CLIENT_URL origin: ${value}`);
    }

    if (!["http:", "https:"].includes(url.protocol) ||
        url.origin !== value.replace(/\/+$/, "")) {
      throw new Error(`CLIENT_URL must contain only HTTP(S) origins: ${value}`);
    }
    return url.origin;
  });

if (clientUrls.length === 0) {
  throw new Error("CLIENT_URL must define at least one allowed frontend origin");
}

const allowedOrigins = new Set(clientUrls);

const corsMiddleware = cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

export default corsMiddleware;
