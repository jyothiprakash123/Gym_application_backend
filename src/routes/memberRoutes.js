const express = require("express");

const {
  createMember,
  getMembers,
  exportMembers,
  getMemberById,
  updateMember,
  deleteMember,
  hardDeleteMember,
  getMemberAchievements,
} = require("../controllers/memberController");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// ======================================================
// CREATE MEMBER
// ======================================================

router.post(
  "/",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin",
    "front-desk"
  ),
  createMember
);

// ======================================================
// GET ALL MEMBERS
// ======================================================

router.get(
  "/",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin",
    "front-desk"
  ),
  getMembers
);

// ======================================================
// EXPORT MEMBERS
// ======================================================

router.get(
  "/export",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin",
    "front-desk"
  ),
  exportMembers
);

// ======================================================
// GET MEMBER BY ID
// ======================================================

router.get(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin",
    "front-desk"
  ),
  getMemberById
);

// ======================================================
// GET MEMBER ACHIEVEMENTS
// ======================================================

router.get(
  "/:id/achievements",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin",
    "front-desk"
  ),
  getMemberAchievements
);

// ======================================================
// UPDATE MEMBER
// ======================================================

router.put(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin",
    "front-desk"
  ),
  updateMember
);

// ======================================================
// DEACTIVATE MEMBER
// ======================================================

router.delete(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin",
    "front-desk"
  ),
  deleteMember
);

// ======================================================
// HARD DELETE
// ======================================================

router.delete(
  "/:id/hard",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin"
  ),
  hardDeleteMember
);

module.exports = router;