const express = require("express");

const {
  createLead,
  getLeads,
  updateLead,
  deleteLead
} = require("../controllers/leadController");

const authenticate = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate);

router.post("/", createLead);
router.get("/", getLeads);
router.put("/:id", updateLead);
router.delete("/:id", deleteLead);

module.exports = router;
