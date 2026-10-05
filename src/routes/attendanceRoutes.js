const express = require("express");

const {
  checkIn,
  checkOut,
  getAttendance,
  updateAttendance,
  deleteAttendance,
} = require("../controllers/attendanceController");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// ======================================================
// CHECK IN
// ======================================================

router.post(
  "/check-in",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk"),
  checkIn
);

// ======================================================
// CHECK OUT
// ======================================================

router.put(
  "/:id/check-out",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk"),
  checkOut
);

// ======================================================
// GET ALL ATTENDANCE
// ======================================================

router.get(
  "/",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk"),
  getAttendance
);

// ======================================================
// DELETE ATTENDANCE
// ======================================================

router.delete(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin"),
  deleteAttendance
);

// ======================================================
// UPDATE ATTENDANCE
// ======================================================

router.put(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk"),
  updateAttendance
);

module.exports = router;
