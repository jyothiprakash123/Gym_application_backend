const express = require("express");

const {
  login,
  refreshToken,
  logout,
  me,
} = require("../controllers/authController");

const authenticate = require("../middleware/authMiddleware");
const { authLimiter, refreshLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

// ======================================================
// PUBLIC AUTH ROUTES
// ======================================================

// POST /api/auth/login
router.post("/login", authLimiter, login);

// POST /api/auth/refresh
router.post("/refresh", refreshLimiter, refreshToken);

// POST /api/auth/logout
router.post("/logout", logout);

// ======================================================
// PROTECTED AUTH ROUTES
// ======================================================

// GET /api/auth/me
router.get("/me", authenticate, me);

module.exports = router;