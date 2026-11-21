require("dotenv").config();

// ======================================================
// ENVIRONMENT VARIABLE VALIDATION
// ======================================================
const requiredEnv = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "DATABASE_URL"];
const missingEnv = requiredEnv.filter((key) => !process.env[key] || process.env[key].trim() === "");

if (missingEnv.length > 0) {
  console.error("==================================================================");
  console.error("FATAL: Application refuses to start due to missing environment variables!");
  console.error(`Missing required variable(s): ${missingEnv.join(", ")}`);
  console.error("Please configure these in your .env file before starting the server.");
  console.error("Run: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" to generate 64-char secrets.");
  console.error("==================================================================");
  process.exit(1);
}

const app = require("./app");
const pool = require("./config/db");

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

let server;

const startServer = async () => {
  try {
    await pool.query("SELECT 1");

    console.log("Database connection successful");

    // Initialize module configs and permissions tables
    const { initSettingsTables } = require("./services/initSettingsTables");
    await initSettingsTables();

    // Start auto-expire sweep service for memberships and freezes
    const { initAutoExpireJob } = require("./services/membershipExpiryService");
    initAutoExpireJob();

    server = app.listen(PORT, () => {
      console.log(
        `Server running in ${NODE_ENV.toUpperCase()} mode on http://localhost:${PORT}`
      );
    });

  } catch (error) {
    console.error(
      "Failed to start server:",
      error
    );

    process.exit(1);
  }
};

// ======================================================
// GRACEFUL SHUTDOWN HANDLER
// ======================================================

const gracefulShutdown = async (signal) => {
  console.log(`\n[Process] Received ${signal}. Starting graceful shutdown...`);

  // 1. Forceful termination watchdog (failsafe against hung connections)
  const forceExitTimer = setTimeout(() => {
    console.error("[Process] Forced shutdown: connections failed to close within 10s timeout.");
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  // 2. Stop accepting new HTTP connections and wait for in-flight requests to complete
  if (server) {
    server.close(async (err) => {
      if (err) {
        console.error("[Process] Error during HTTP server closure:", err);
      } else {
        console.log("[Process] HTTP server closed cleanly. In-flight requests finished.");
      }

      // 3. Drain and close database pool
      try {
        await pool.end();
        console.log("[Process] PostgreSQL connection pool drained and closed.");
        process.exit(0);
      } catch (poolErr) {
        console.error("[Process] Error while draining PostgreSQL pool:", poolErr);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
};

// Listen for termination signals (Docker, Render, Railway, Kubernetes, PM2, Ctrl+C)
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Global safety net for unhandled rejections and exceptions
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Process] Unhandled Promise Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught Exception thrown:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

startServer();