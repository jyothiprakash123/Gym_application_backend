const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const authenticate = require("../middleware/authMiddleware");

// All routes are protected
router.use(authenticate);

router.get("/", notificationController.getNotifications);
router.put("/:id/read", notificationController.markAsRead);

module.exports = router;
