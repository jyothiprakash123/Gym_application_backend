const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { getAllowedRoles } = require("../config/rbacConfig");

const {
  exportPlans,
  createPlan,
  getPlans,
  getPlanById,
  updatePlan,
  deletePlan,
  hardDeletePlan,
} = require("../controllers/planController");

const router = express.Router();

router.use(authenticate);

// Dynamic RBAC per permission matrix
router.get("/", authorizeRoles(...getAllowedRoles("plans", "view")), getPlans);
router.get("/export", authorizeRoles(...getAllowedRoles("plans", "view")), exportPlans);
router.get("/:id", authorizeRoles(...getAllowedRoles("plans", "view")), getPlanById);

router.post("/", authorizeRoles(...getAllowedRoles("plans", "create")), createPlan);
router.put("/:id", authorizeRoles(...getAllowedRoles("plans", "edit")), updatePlan);
router.delete("/:id", authorizeRoles(...getAllowedRoles("plans", "delete")), deletePlan);
router.delete("/:id/hard", authorizeRoles("system-admin", "super-admin"), hardDeletePlan);

module.exports = router;
