const express = require("express");
const {
  createMessage,
  getMessages,
  getMessageById,
  updateMessage,
  toggleMessageStatus,
  deleteMessage,
  getRecipientsPreview,
  sendMessageToMembers,
} = require("../controllers/messageController");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// ======================================================
// GET ALL MESSAGES (With Gym, Branch, Search, Filters)
// ======================================================
router.get(
  "/",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk", "trainer", "accountant"),
  getMessages
);

// ======================================================
// GET MESSAGE BY ID
// ======================================================
router.get(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk", "trainer", "accountant"),
  getMessageById
);

// ======================================================
// CREATE MESSAGE
// ======================================================
router.post(
  "/",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk"),
  createMessage
);

// ======================================================
// UPDATE MESSAGE
// ======================================================
router.put(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk"),
  updateMessage
);

// ======================================================
// TOGGLE STATUS
// ======================================================
router.patch(
  "/:id/status",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk"),
  toggleMessageStatus
);

// ======================================================
// GET RECIPIENTS PREVIEW
// ======================================================
router.get(
  "/:id/recipients",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk"),
  getRecipientsPreview
);

// ======================================================
// SEND MESSAGE TO MEMBERS (VIA SMTP EMAIL)
// ======================================================
router.post(
  "/:id/send",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk"),
  sendMessageToMembers
);

// ======================================================
// DELETE MESSAGE
// ======================================================
router.delete(
  "/:id",
  authenticate,
  authorizeRoles("system-admin", "super-admin", "admin", "front-desk"),
  deleteMessage
);

module.exports = router;
