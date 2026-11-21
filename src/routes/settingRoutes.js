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
  resetGymModulesToCommon,
  getRolesList,
  createRole,
  updateRole,
  deleteRole,
  getMasterConfigs,
  updateMasterConfigs
} = require("../controllers/settingsController");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

// Retrieve settings
router.get("/", authenticate, getSettings);

// Upsert setting (system-admin and super-admin only)
router.post("/", authenticate, authorizeRoles("system-admin", "super-admin"), upsertSetting);

// Masters System Configurations (System Admin Only)
router.get("/masters", authenticate, authorizeRoles("system-admin"), getMasterConfigs);
router.put("/masters", authenticate, authorizeRoles("system-admin"), updateMasterConfigs);

// Roles CRUD (system-admin and super-admin only)
router.get("/roles", authenticate, authorizeRoles("system-admin", "super-admin"), getRolesList);
router.post("/roles", authenticate, authorizeRoles("system-admin", "super-admin"), createRole);
router.put("/roles/:id", authenticate, authorizeRoles("system-admin", "super-admin"), updateRole);
router.delete("/roles/:id", authenticate, authorizeRoles("system-admin", "super-admin"), deleteRole);

// Granular Permissions (system-admin and super-admin only)
router.get("/granular-permissions", authenticate, authorizeRoles("system-admin", "super-admin"), getGranularPermissions);
router.put("/granular-permissions", authenticate, authorizeRoles("system-admin", "super-admin"), updateGranularPermissions);
router.post("/granular-permissions/reset", authenticate, authorizeRoles("system-admin", "super-admin"), resetGymPermissionsToCommon);

// Modules Configuration (On/Off) (system-admin and super-admin only)
router.get("/modules", authenticate, authorizeRoles("system-admin", "super-admin"), getModulesConfig);
router.put("/modules", authenticate, authorizeRoles("system-admin", "super-admin"), updateModulesConfig);
router.post("/modules/reset", authenticate, authorizeRoles("system-admin", "super-admin"), resetGymModulesToCommon);

// Sidebar and Permissions
router.get("/sidebar", authenticate, getSidebar);
router.get("/menu-items", authenticate, authorizeRoles("system-admin", "super-admin"), getAllMenuItems);
router.get("/roles/:role_id/permissions", authenticate, authorizeRoles("system-admin", "super-admin"), getRolePermissions);
router.put("/roles/:role_id/permissions", authenticate, authorizeRoles("system-admin", "super-admin"), updateRolePermissions);

module.exports = router;
