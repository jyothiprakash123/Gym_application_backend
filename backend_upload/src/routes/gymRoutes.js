const express = require("express");

const {
  createGym,
  getGyms,
  getGymById,
  updateGym,
  deleteGym,
  hardDeleteGym,
  getBillingPlans,
} = require("../controllers/gymController");

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
  createGym
);

// ======================================================
// GET ALL
// ======================================================

router.get(
  "/",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin"),
  getGyms
);

// ======================================================
// GET BILLING PLANS
// ======================================================

router.get(
  "/billing-plans",
  authenticate,
  authorizeRoles("system-admin", "super-admin"),
  getBillingPlans
);

// ======================================================
// GET ONE
// ======================================================

router.get(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin"),
  getGymById
);

// ======================================================
// UPDATE
// ======================================================

router.put(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin"),
  updateGym
);

// ======================================================
// DELETE / DEACTIVATE (Soft Delete)
// ======================================================

router.delete(
  "/:id",
  authenticate,
  authorizeRoles("system-admin"),
  deleteGym
);

// ======================================================
// HARD DELETE
// ======================================================

router.delete(
  "/:id/hard",
  authenticate,
  authorizeRoles("system-admin"),
  hardDeleteGym
);

module.exports = router;