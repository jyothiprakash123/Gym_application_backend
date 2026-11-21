const express = require("express");

const {
  createLead,
  getLeads,
  updateLead,
  deleteLead,
  getLeadInteractions,
  addLeadInteraction,
  deleteLeadInteraction,
  convertLeadToMember,
} = require("../controllers/leadController");

const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const { getAllowedRoles } = require("../config/rbacConfig");

const router = express.Router();

router.use(authenticate);

router.post("/", authorizeRoles(...getAllowedRoles("leads", "create")), createLead);
router.get("/", authorizeRoles(...getAllowedRoles("leads", "view")), getLeads);
router.put("/:id", authorizeRoles(...getAllowedRoles("leads", "edit")), updateLead);
router.delete("/:id", authorizeRoles(...getAllowedRoles("leads", "delete")), deleteLead);
router.post("/:id/convert", authorizeRoles(...getAllowedRoles("leads", "edit")), convertLeadToMember);

// Lead interaction notes
router.get("/:id/interactions", authorizeRoles(...getAllowedRoles("leads", "view")), getLeadInteractions);
router.post("/:id/interactions", authorizeRoles(...getAllowedRoles("leads", "create")), addLeadInteraction);
router.delete("/:id/interactions/:interactionId", authorizeRoles(...getAllowedRoles("leads", "delete")), deleteLeadInteraction);

// Aliases for /:id/notes
router.get("/:id/notes", authorizeRoles(...getAllowedRoles("leads", "view")), getLeadInteractions);
router.post("/:id/notes", authorizeRoles(...getAllowedRoles("leads", "create")), addLeadInteraction);
router.delete("/:id/notes/:interactionId", authorizeRoles(...getAllowedRoles("leads", "delete")), deleteLeadInteraction);

module.exports = router;
