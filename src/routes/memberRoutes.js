const express = require("express");

const {
  createMember,
  getMembers,
  exportMembers,
  importMembers,
  holdMemberFees,
  resumeMemberFees,
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
// IMPORT MEMBERS
// ======================================================

router.post(
  "/import",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin",
    "front-desk"
  ),
  importMembers
);

// ======================================================
// HOLD FEES (FREEZE MEMBERSHIP)
// ======================================================

router.post(
  "/:id/hold-fees",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin",
    "front-desk"
  ),
  holdMemberFees
);

// ======================================================
// RESUME FEES (UNFREEZE MEMBERSHIP)
// ======================================================

router.post(
  "/:id/resume-fees",
  authenticate,
  authorizeRoles("system-admin", "super-admin",
    "admin",
    "front-desk"
  ),
  resumeMemberFees
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