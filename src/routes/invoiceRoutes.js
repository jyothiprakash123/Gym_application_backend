const express = require("express");
const {
  getInvoices,
  getInvoiceById,
  getInvoiceByPaymentId,
} = require("../controllers/invoiceController");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { getAllowedRoles } = require("../config/rbacConfig");

const router = express.Router();

// Apply authentication to all invoice routes
router.use(authenticate);

// List invoices with pagination, filters and tenant isolation
router.get("/", authorizeRoles(...getAllowedRoles("invoices", "view")), getInvoices);

// Get single invoice by payment ID (Receipt view)
router.get("/payment/:paymentId", authorizeRoles(...getAllowedRoles("invoices", "view")), getInvoiceByPaymentId);

// Get single invoice by invoice ID or invoice number
router.get("/:id", authorizeRoles(...getAllowedRoles("invoices", "view")), getInvoiceById);

module.exports = router;
