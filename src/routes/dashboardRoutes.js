const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const authMiddleware = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/rbacMiddleware");

// All dashboard routes should be protected
router.use(authMiddleware);

router.get("/overview", requirePermission("dashboard", "view"), dashboardController.getOverview);

module.exports = router;
