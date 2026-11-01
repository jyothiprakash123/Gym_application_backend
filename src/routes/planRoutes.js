const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

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

// Allow front-desk to READ membership plans (list, get, export)
router.get("/", authorizeRoles("system-admin", "super-admin", "admin", "front-desk"), getPlans);
router.get("/export", authorizeRoles("system-admin", "super-admin", "admin", "front-desk"), exportPlans);
router.get("/:id", authorizeRoles("system-admin", "super-admin", "admin", "front-desk"), getPlanById);

// Create, update, and delete stay strictly limited to admin, super-admin, and system-admin
router.post("/", authorizeRoles("system-admin", "super-admin", "admin"), createPlan);
router.put("/:id", authorizeRoles("system-admin", "super-admin", "admin"), updatePlan);
router.delete("/:id", authorizeRoles("system-admin", "super-admin", "admin"), deletePlan);
router.delete("/:id/hard", authorizeRoles("system-admin", "super-admin"), hardDeletePlan);

module.exports = router;
