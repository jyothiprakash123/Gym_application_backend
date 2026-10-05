const express = require("express");
const router = express.Router();
const achievementController = require("../controllers/achievementController");
const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);

router.get("/", achievementController.getAchievements);
router.get("/:id", achievementController.getAchievement);
router.post("/", achievementController.createAchievement);
router.put("/:id", achievementController.updateAchievement);
router.delete("/:id", achievementController.deleteAchievement);

module.exports = router;
