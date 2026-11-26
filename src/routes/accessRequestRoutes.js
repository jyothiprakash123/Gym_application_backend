const express = require("express");
const {
  createAccessRequest,
  getAccessRequests,
  getAccessRequestById,
  convertAccessRequest,
  updateAccessRequestStatus,
  deleteAccessRequest,
} = require("../controllers/accessRequestController");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { apiLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

// Public route to submit plan access request from landing page
router.post("/", apiLimiter, createAccessRequest);

// System Admin only management endpoints
router.get("/", authenticate, authorizeRoles("system-admin"), getAccessRequests);
router.get("/:id", authenticate, authorizeRoles("system-admin"), getAccessRequestById);
router.post("/:id/convert", authenticate, authorizeRoles("system-admin"), convertAccessRequest);
router.put("/:id/status", authenticate, authorizeRoles("system-admin"), updateAccessRequestStatus);
router.delete("/:id", authenticate, authorizeRoles("system-admin"), deleteAccessRequest);

module.exports = router;
