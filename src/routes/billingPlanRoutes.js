const express = require("express");
const {
  createBillingPlan,
  getBillingPlans,
  getBillingPlanById,
  updateBillingPlan,
  deleteBillingPlan,
  hardDeleteBillingPlan
} = require("../controllers/billingPlanController");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

router.post("/", authenticate, authorizeRoles("system-admin"), createBillingPlan);
router.get("/", authenticate, authorizeRoles("system-admin", "super-admin"), getBillingPlans);
router.get("/:id", authenticate, authorizeRoles("system-admin", "super-admin"), getBillingPlanById);
router.put("/:id", authenticate, authorizeRoles("system-admin"), updateBillingPlan);
router.delete("/:id", authenticate, authorizeRoles("system-admin"), deleteBillingPlan);
router.delete("/:id/hard", authenticate, authorizeRoles("system-admin"), hardDeleteBillingPlan);

module.exports = router;
