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
  updateRolePermissions,
  getGranularPermissions,
  updateGranularPermissions,
  resetGymPermissionsToCommon,
  getModulesConfig,
  updateModulesConfig,
  resetGymModulesToCommon
} = require("../controllers/settingsController");

const authenticate = require("../middleware/authMiddleware");

// Retrieve settings
router.get("/", authenticate, getSettings);

// Upsert setting
router.post("/", authenticate, upsertSetting);

// Granular Permissions
router.get("/granular-permissions", authenticate, getGranularPermissions);
router.put("/granular-permissions", authenticate, updateGranularPermissions);
router.post("/granular-permissions/reset", authenticate, resetGymPermissionsToCommon);

// Modules Configuration (On/Off)
router.get("/modules", authenticate, getModulesConfig);
router.put("/modules", authenticate, updateModulesConfig);
router.post("/modules/reset", authenticate, resetGymModulesToCommon);

// Sidebar and Permissions
router.get("/sidebar", authenticate, getSidebar);
router.get("/menu-items", authenticate, getAllMenuItems);
router.get("/roles/:role_id/permissions", authenticate, getRolePermissions);
router.put("/roles/:role_id/permissions", authenticate, updateRolePermissions);

module.exports = router;
