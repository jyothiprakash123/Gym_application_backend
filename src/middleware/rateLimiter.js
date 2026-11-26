const rateLimit = require("express-rate-limit");

/**
 * Checks whether the incoming request is in development/test environment
 * or originating from localhost/loopback.
 */
const isDevOrLocal = (req) => {
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "true") {
    return true;
  }
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  const ip = req.ip || req.connection?.remoteAddress || "";
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    req.hostname === "localhost"
  );
};

/**
 * Auth Rate Limiter
 * Guards sensitive auth endpoints (/api/auth/login)
 * against brute-force attacks and credential stuffing.
 * - Only counts FAILED attempts (skipSuccessfulRequests: true)
 * - Skips in local development / testing
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 failed attempts per 15 minutes in production
  skipSuccessfulRequests: true, // Crucial: Successful logins never lock users out
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many failed authentication attempts. Please try again after 15 minutes.",
  },
  skip: isDevOrLocal,
});

/**
 * Refresh Token Limiter
 * Token refresh is routine background traffic, so it gets a generous limit.
 */
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 token refreshes per 15 minutes in production
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many token refresh requests. Please wait a moment.",
  },
  skip: isDevOrLocal,
});

/**
 * Global API Rate Limiter
 * Guards against API spam and general denial of service.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 600, // 600 requests/min in production
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP. Please slow down.",
  },
  skip: isDevOrLocal,
});

module.exports = {
  authLimiter,
  refreshLimiter,
  apiLimiter,
};

