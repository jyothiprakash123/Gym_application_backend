const express = require("express");
const router = express.Router();

const {
  getSettings,
  upsertSetting,
} = require("../controllers/settingController");

const {
  getSidebar,
  getAllMenuItems,
  getRolePermissions,
  updateRolePermissions
} = require("../controllers/settingsController");

const authenticate = require("../middleware/authMiddleware");

// Retrieve settings
router.get("/", authenticate, getSettings);

// Upsert setting
router.post("/", authenticate, upsertSetting);

// Sidebar and Permissions
router.get("/sidebar", authenticate, getSidebar);
router.get("/menu-items", authenticate, getAllMenuItems);
router.get("/roles/:role_id/permissions", authenticate, getRolePermissions);
router.put("/roles/:role_id/permissions", authenticate, updateRolePermissions);

module.exports = router;
