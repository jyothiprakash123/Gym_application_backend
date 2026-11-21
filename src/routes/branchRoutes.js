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
const { requirePermission } = require("../middleware/rbacMiddleware");

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

// Enforce central RBAC (system-admin, super-admin, admin, front-desk, trainer, accountant)
// Row-level scoping in branchController restricts branch-bound staff to their own branch.
router.get(
  "/",
  authenticate,
  requirePermission("branches", "view"),
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