const rateLimit = require("express-rate-limit");

/**
 * Auth Rate Limiter
 * Guards sensitive auth endpoints (/api/auth/login, /api/auth/refresh)
 * against brute-force attacks and bcrypt CPU exhaustion.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "test" ? 1000 : 15, // 15 attempts in production, permissive in tests
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again after 15 minutes.",
  },
  skip: (req) => process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "true",
});

/**
 * Global API Rate Limiter
 * Guards against API spam and general denial of service.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === "test" ? 5000 : 300, // 300 requests/min
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP. Please slow down.",
  },
  skip: (req) => process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "true",
});

module.exports = {
  authLimiter,
  apiLimiter,
};

