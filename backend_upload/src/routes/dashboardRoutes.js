const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const authMiddleware = require("../middleware/authMiddleware");

// All dashboard routes should be protected
router.use(authMiddleware);

router.get("/overview", dashboardController.getOverview);

module.exports = router;
