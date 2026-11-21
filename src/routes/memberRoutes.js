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
const { getAllowedRoles } = require("../config/rbacConfig");

const router = express.Router();

// ======================================================
// CREATE MEMBER
// ======================================================

router.post(
  "/",
  authenticate,
  authorizeRoles(...getAllowedRoles("members", "create")),
  createMember
);

// ======================================================
// GET ALL MEMBERS
// ======================================================

router.get(
  "/",
  authenticate,
  authorizeRoles(...getAllowedRoles("members", "view")),
  getMembers
);

// ======================================================
// EXPORT MEMBERS
// ======================================================

router.get(
  "/export",
  authenticate,
  authorizeRoles(...getAllowedRoles("members", "view")),
  exportMembers
);

// ======================================================
// IMPORT MEMBERS
// ======================================================

router.post(
  "/import",
  authenticate,
  authorizeRoles(...getAllowedRoles("members", "create")),
  importMembers
);

// ======================================================
// HOLD FEES (FREEZE MEMBERSHIP)
// ======================================================

router.post(
  "/:id/hold-fees",
  authenticate,
  authorizeRoles(...getAllowedRoles("members", "edit")),
  holdMemberFees
);

// ======================================================
// RESUME FEES (UNFREEZE MEMBERSHIP)
// ======================================================

router.post(
  "/:id/resume-fees",
  authenticate,
  authorizeRoles(...getAllowedRoles("members", "edit")),
  resumeMemberFees
);

// ======================================================
// GET MEMBER BY ID
// ======================================================

router.get(
  "/:id",
  authenticate,
  authorizeRoles(...getAllowedRoles("members", "view")),
  getMemberById
);

// ======================================================
// GET MEMBER ACHIEVEMENTS
// ======================================================

router.get(
  "/:id/achievements",
  authenticate,
  authorizeRoles(...getAllowedRoles("members", "view")),
  getMemberAchievements
);

// ======================================================
// UPDATE MEMBER
// ======================================================

router.put(
  "/:id",
  authenticate,
  authorizeRoles(...getAllowedRoles("members", "edit")),
  updateMember
);

// ======================================================
// DEACTIVATE MEMBER
// ======================================================

router.delete(
  "/:id",
  authenticate,
  authorizeRoles(...getAllowedRoles("members", "delete")),
  deleteMember
);

// ======================================================
// HARD DELETE
// ======================================================

router.delete(
  "/:id/hard",
  authenticate,
  authorizeRoles("system-admin", "super-admin"),
  hardDeleteMember
);

module.exports = router;