const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const pool = require("./config/db");
const { apiLimiter } = require("./middleware/rateLimiter");

const authRoutes = require("./routes/authRoutes");
const memberRoutes = require("./routes/memberRoutes");
const branchRoutes = require("./routes/branchRoutes");
const gymRoutes = require("./routes/gymRoutes");
const staffRoutes = require("./routes/staffRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const planRoutes = require("./routes/planRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const settingRoutes = require("./routes/settingRoutes");
const userRoutes = require("./routes/userRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const achievementRoutes = require("./routes/achievementRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const leadRoutes = require("./routes/leadRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const billingPlanRoutes = require("./routes/billingPlanRoutes");
const messageRoutes = require("./routes/messageRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const accessRequestRoutes = require("./routes/accessRequestRoutes");

const authenticate = require("./middleware/authMiddleware");
const authorizeRoles = require("./middleware/roleMiddleware");

const app = express();

// ======================================================
// PRODUCTION PROXY & COMPRESSION CONFIGURATION
// ======================================================

// Trust reverse proxy headers (Render, Railway, Vercel, Nginx, AWS ALB)
// Required for accurate req.ip, rate-limiting, and Secure cross-site cookies
const rawTrustProxy = process.env.TRUST_PROXY ?? "1";
const trustProxyVal =
  rawTrustProxy === "true"
    ? true
    : rawTrustProxy === "false"
    ? false
    : isNaN(Number(rawTrustProxy))
    ? rawTrustProxy
    : Number(rawTrustProxy);
app.set("trust proxy", trustProxyVal);

// Enable Gzip/Deflate compression for all response payloads > 1KB
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  })
);

// Production / Development Request Logging
const isProd = process.env.NODE_ENV === "production";
if (isProd) {
  app.use(
    morgan("combined", {
      skip: (req) => req.url === "/api/health" || req.url === "/health",
    })
  );
} else if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// ======================================================
// GLOBAL MIDDLEWARE
// ======================================================

// 1. Helmet HTTP Security Headers
app.use(
  helmet({
    contentSecurityPolicy: false, // Managed by reverse proxy or client SPA
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// 2. CORS Dynamic Whitelist & Preflight Handling
const defaultAllowedOrigins = [
  "https://gym-application-frontend-seven.vercel.app",
  "https://gym-application-frontend.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
];

const envAllowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.CLIENT_URL,
  process.env.ALLOWED_ORIGINS,
]
  .filter(Boolean)
  .flatMap((entry) => entry.split(","))
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envAllowedOrigins]));

// Regex for Vercel preview deployments (e.g. https://gym-application-frontend-git-main-user.vercel.app)
const vercelPreviewRegex = /^https:\/\/gym-application-frontend(-[a-z0-9-]+)?\.vercel\.app$/i;
const customRegex = process.env.CORS_ORIGIN_REGEX ? new RegExp(process.env.CORS_ORIGIN_REGEX, "i") : null;

const corsOptions = {
  origin: (origin, callback) => {
    // 1. Allow requests with no origin (e.g. mobile apps, curl, server-to-server, health check probes)
    if (!origin) {
      return callback(null, true);
    }

    // 2. Exact match against allowed origins whitelist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // 3. Match against Vercel preview deployment regex pattern
    if (vercelPreviewRegex.test(origin)) {
      return callback(null, true);
    }

    // 4. Match against optional custom regex from environment
    if (customRegex && customRegex.test(origin)) {
      return callback(null, true);
    }

    // 5. In non-production environments, allow any localhost/127.0.0.1 port
    if (
      process.env.NODE_ENV !== "production" &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "x-no-compression",
  ],
  exposedHeaders: ["Set-Cookie"],
  maxAge: 86400, // 24 hours pre-flight cache
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// 3. Body Parsers with 5MB Caps (Prevents Oversized Payload DoS)
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// 4. Global API Rate Limiter
app.use("/api", apiLimiter);

app.use(cookieParser());

// ======================================================
// HEALTH CHECK (Probes DB connectivity & system stats)
// ======================================================
const healthCheckHandler = async (req, res) => {
  const startTime = Date.now();
  try {
    // Probe database connectivity
    await pool.query("SELECT 1");
    const dbLatencyMs = Date.now() - startTime;

    return res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || "development",
      database: {
        status: "connected",
        latencyMs: dbLatencyMs,
      },
      memoryUsage: {
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      version: "1.0.0",
    });
  } catch (err) {
    console.error("Health check DB probe failed:", err.message);
    return res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || "development",
      database: {
        status: "disconnected",
        error: process.env.NODE_ENV === "production" ? "Database connectivity failed" : err.message,
      },
    });
  }
};

app.get("/health", healthCheckHandler);
app.get("/api/health", healthCheckHandler);

// ======================================================
// AUTH ROUTES
// ======================================================

app.use("/api/auth", authRoutes);

// ======================================================
// MEMBER ROUTES
// ======================================================

app.use("/api/members", memberRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/gyms", gymRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/settings", settingRoutes);
app.use("/api/users", userRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/achievements", achievementRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/billing-plans", billingPlanRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/access-requests", accessRequestRoutes);

// ======================================================
// SUPER ADMIN TEST ROUTE
// ======================================================

// app.get(
//   "/api/test/super-admin",
//   authenticate,
//   authorizeRoles("super-admin"),
//   (req, res) => {
//     res.status(200).json({
//       success: true,
//       message: "Super Admin access granted",
//       user: {
//         id: req.user.id,
//         email: req.user.email,
//         role: req.user.role_name,
//       },
//     });
//   }
// );

// ======================================================
// TEST SIMULATION ROUTE (Development & Testing only)
// ======================================================

if (process.env.NODE_ENV !== "production") {
  app.get("/api/test-simulated-error/:type", (req, res, next) => {
    const { type } = req.params;
    if (type === "duplicate") {
      const err = new Error('duplicate key value violates unique constraint "uq_attendance_member_date"');
      err.code = "23505";
      err.detail = "Key (member_id, attendance_date) already exists in attendance.";
      return next(err);
    }
    if (type === "foreign-key") {
      const err = new Error('insert or update on table "members" violates foreign key constraint');
      err.code = "23503";
      return next(err);
    }
    if (type === "sql-leak") {
      const err = new Error('syntax error at or near "SELECT" from table users');
      err.status = 500;
      return next(err);
    }
    next(new Error("Unknown test error"));
  });
}

// ======================================================
// 404
// ======================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// ======================================================
// ERROR HANDLER (Sanitizes internal details & translates DB exceptions)
// ======================================================

app.use((error, req, res, next) => {
  // In non-production, log full error for debugging
  if (process.env.NODE_ENV !== "production") {
    console.error("Server Error:", error);
  } else {
    console.error(`[Error] ${req.method} ${req.originalUrl}: ${error.message}`);
  }

  // 1. Handle CORS blocked origin errors specifically
  if (error.message && error.message.startsWith("CORS blocked")) {
    return res.status(403).json({
      success: false,
      message: "Origin blocked by CORS policy",
    });
  }

  // 2. Handle payload too large errors
  if (error.type === "entity.too.large" || error.status === 413) {
    return res.status(413).json({
      success: false,
      message: "Request payload too large (maximum allowed is 5MB)",
    });
  }

  // 3. PostgreSQL Specific Error Code Translation
  if (error.code) {
    switch (error.code) {
      case "23505": { // unique_violation
        let userMsg = "A record with this information already exists.";
        if (error.detail && error.detail.includes("email")) {
          userMsg = "This email address is already registered.";
        } else if (error.detail && error.detail.includes("attendance")) {
          userMsg = "Attendance has already been marked for this member today.";
        } else if (error.detail && error.detail.includes("phone")) {
          userMsg = "This phone number is already registered.";
        }
        return res.status(409).json({ success: false, message: userMsg });
      }
      case "23503": { // foreign_key_violation
        return res.status(400).json({
          success: false,
          message: "Cannot complete operation: a referenced record was not found or is currently in use.",
        });
      }
      case "23502": { // not_null_violation
        const col = error.column ? ` for '${error.column}'` : "";
        return res.status(400).json({
          success: false,
          message: `Missing required field value${col}.`,
        });
      }
      case "22P02": { // invalid_text_representation (e.g. invalid UUID, integer)
        return res.status(400).json({
          success: false,
          message: "Invalid identifier or parameter format provided.",
        });
      }
      case "22001": { // string_data_right_truncation
        return res.status(400).json({
          success: false,
          message: "Input text exceeds maximum allowed character length.",
        });
      }
    }
  }

  // 4. JWT Authentication Errors
  if (error.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Your session has expired. Please log in again.",
    });
  }
  if (error.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid session token. Please log in again.",
    });
  }

  const isProd = process.env.NODE_ENV === "production";
  const statusCode = error.status || error.statusCode || 500;

  // 5. Technical SQL / Internal Leak Detection
  const rawMsg = error.message || "";
  const isTechnicalLeak =
    /syntax error|relation .* does not exist|column .* does not exist|table .* does not exist|violates foreign key|select .* from|insert into|update .* set|delete from/i.test(
      rawMsg
    );

  // Never leak SQL internal details, table names, or stack traces
  let clientMessage = rawMsg;
  if (isProd || isTechnicalLeak || statusCode === 500) {
    clientMessage =
      statusCode === 500
        ? "An unexpected internal server error occurred. Please try again."
        : "A database validation error occurred. Please verify your inputs.";
  }

  res.status(statusCode).json({
    success: false,
    message: clientMessage,
  });
});

module.exports = app;
