const express = require("express");
const router = express.Router();
const {
  createStaff,
  getStaff,
  getStaffById,
  updateStaff,
  deleteStaff,
  hardDeleteStaff,
} = require("../controllers/staffController");
const authMiddleware = require("../middleware/authMiddleware");
const checkRole = require("../middleware/roleMiddleware");

// All routes require authentication
router.use(authMiddleware);

// Routes
router.post("/", checkRole("system-admin", "super-admin", "admin"), createStaff);
router.get("/", checkRole("system-admin", "super-admin", "admin"), getStaff);
router.get("/:id", checkRole("system-admin", "super-admin", "admin"), getStaffById);
router.put("/:id", checkRole("system-admin", "super-admin", "admin"), updateStaff);
router.delete("/:id", checkRole("system-admin", "super-admin", "admin"), deleteStaff);
router.delete("/:id/hard", checkRole("system-admin", "super-admin", "admin"), hardDeleteStaff);

module.exports = router;
