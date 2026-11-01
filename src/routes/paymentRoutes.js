const express = require("express");
const {
  createPayment,
  getPayments,
  getPaymentById,
  updatePayment,
  deletePayment,
  hardDeletePayment,
} = require("../controllers/paymentController");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const { getAllowedRoles } = require("../config/rbacConfig");

const router = express.Router();

// Apply authentication to all payment routes
router.use(authenticate);

// Dynamic RBAC permissions per endpoint based on central permission matrix
router.post("/", authorizeRoles(...getAllowedRoles("payments", "create")), createPayment);
router.get("/", authorizeRoles(...getAllowedRoles("payments", "view")), getPayments);
router.get("/:id", authorizeRoles(...getAllowedRoles("payments", "view")), getPaymentById);
router.put("/:id", authorizeRoles(...getAllowedRoles("payments", "edit")), updatePayment);
router.delete("/:id", authorizeRoles(...getAllowedRoles("payments", "delete")), deletePayment);
router.delete("/:id/hard", authorizeRoles("system-admin", "super-admin"), hardDeletePayment);

module.exports = router;
