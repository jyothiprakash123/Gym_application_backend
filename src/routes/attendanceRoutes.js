const express = require("express");

const {
  checkIn,
  markBulkAttendance,
  updateBulkAttendance,
  checkOut,
  getAttendance,
  updateAttendance,
  deleteAttendance,
  deleteBulkAttendance,
} = require("../controllers/attendanceController");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { getAllowedRoles } = require("../config/rbacConfig");

const router = express.Router();

// ======================================================
// BULK MARK ATTENDANCE
// ======================================================

router.post(
  "/bulk",
  authenticate,
  authorizeRoles(...getAllowedRoles("attendance", "create")),
  markBulkAttendance
);

// ======================================================
// BULK UPDATE ATTENDANCE
// ======================================================

router.put(
  "/bulk",
  authenticate,
  authorizeRoles(...getAllowedRoles("attendance", "edit")),
  updateBulkAttendance
);

// ======================================================
// DELETE BULK ATTENDANCE
// ======================================================

router.delete(
  "/bulk",
  authenticate,
  authorizeRoles(...getAllowedRoles("attendance", "delete")),
  deleteBulkAttendance
);

// ======================================================
// CHECK IN
// ======================================================

router.post(
  "/check-in",
  authenticate,
  authorizeRoles(...getAllowedRoles("attendance", "create")),
  checkIn
);

// ======================================================
// CHECK OUT
// ======================================================

router.put(
  "/:id/check-out",
  authenticate,
  authorizeRoles(...getAllowedRoles("attendance", "create")),
  checkOut
);

router.post(
  "/check-out",
  authenticate,
  authorizeRoles(...getAllowedRoles("attendance", "create")),
  checkOut
);

// ======================================================
// GET ALL ATTENDANCE
// ======================================================

router.get(
  "/",
  authenticate,
  authorizeRoles(...getAllowedRoles("attendance", "view")),
  getAttendance
);

// ======================================================
// DELETE ATTENDANCE
// ======================================================

router.delete(
  "/:id",
  authenticate,
  authorizeRoles(...getAllowedRoles("attendance", "delete")),
  deleteAttendance
);

// ======================================================
// UPDATE ATTENDANCE
// ======================================================

router.put(
  "/:id",
  authenticate,
  authorizeRoles(...getAllowedRoles("attendance", "edit")),
  updateAttendance
);

module.exports = router;
