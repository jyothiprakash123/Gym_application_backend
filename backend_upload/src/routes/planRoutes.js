const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const {
  createPlan,
  getPlans,
  getPlanById,
  updatePlan,
  deletePlan,
  hardDeletePlan,
} = require("../controllers/planController");

const router = express.Router();

router.use(authenticate);

router.post("/", authorizeRoles("system-admin", "super-admin", "admin"), createPlan);
router.get("/", getPlans);
router.get("/:id", getPlanById);
router.put("/:id", authorizeRoles("system-admin", "super-admin", "admin"), updatePlan);
router.delete("/:id", authorizeRoles("system-admin", "super-admin", "admin"), deletePlan);
router.delete("/:id/hard", authorizeRoles("system-admin", "super-admin"), hardDeletePlan);

module.exports = router;
