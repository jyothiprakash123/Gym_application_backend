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

const router = express.Router();

// Apply authentication to all payment routes
router.use(authenticate);

// Allow super-admin and admin to manage payments
router.use(authorizeRoles("system-admin", "super-admin", "admin"));

router.post("/", createPayment);
router.get("/", getPayments);
router.get("/:id", getPaymentById);
router.put("/:id", updatePayment);
router.delete("/:id", deletePayment); // Soft delete / cancel
router.delete("/:id/hard", authorizeRoles("system-admin", "super-admin"), hardDeletePayment);

module.exports = router;
