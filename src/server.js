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

    app.listen(PORT, () => {
      console.log(
        `Server running on http://localhost:${PORT}`
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

startServer();