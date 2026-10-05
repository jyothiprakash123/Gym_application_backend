const express = require("express");

const {
  login,
  refreshToken,
  logout,
  me,
} = require("../controllers/authController");

const authenticate = require("../middleware/authMiddleware");

const router = express.Router();

// ======================================================
// PUBLIC AUTH ROUTES
// ======================================================

// POST /api/auth/login
router.post("/login", login);

// POST /api/auth/refresh
router.post("/refresh", refreshToken);

// POST /api/auth/logout
router.post("/logout", logout);

// ======================================================
// PROTECTED AUTH ROUTES
// ======================================================

// GET /api/auth/me
router.get("/me", authenticate, me);

module.exports = router;