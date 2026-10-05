const express = require("express");

const {
  createBranch,
  getBranches,
  getBranchById,
  updateBranch,
  deleteBranch,
  hardDeleteBranch,
} = require("../controllers/branchController");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// ======================================================
// CREATE
// ======================================================

router.post(
  "/",
  authenticate,
  authorizeRoles("system-admin", "super-admin"),
  createBranch
);

// ======================================================
// GET ALL
// ======================================================

// Both super-admin and admin can view branches
router.get(
  "/",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin"),
  getBranches
);

// ======================================================
// GET ONE
// ======================================================

router.get(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin"),
  getBranchById
);

// ======================================================
// UPDATE
// ======================================================

router.put(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin"),
  updateBranch
);

// ======================================================
// DELETE / DEACTIVATE (Soft Delete)
// ======================================================

router.delete(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin"),
  deleteBranch
);

// ======================================================
// HARD DELETE
// ======================================================

router.delete(
  "/:id/hard",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin"),
  hardDeleteBranch
);

module.exports = router;