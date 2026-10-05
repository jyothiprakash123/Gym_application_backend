const express = require("express");
const { 
  updateProfile, 
  getRoles,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser
} = require("../controllers/userController");
const authenticate = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// ======================================================
// UPDATE USER PROFILE
// ======================================================

router.put("/profile", authenticate, updateProfile);

// ======================================================
// GET ROLES
// ======================================================

router.get("/roles", authenticate, getRoles);

// ======================================================
// MANAGE USERS (SYSTEM ADMIN, SUPER ADMIN, ADMIN)
// ======================================================

router.get("/manage", authenticate, authorizeRoles("system-admin", "super-admin", "admin"), getAllUsers);
router.post("/manage", authenticate, authorizeRoles("system-admin", "super-admin", "admin"), createUser);
router.put("/manage/:id", authenticate, authorizeRoles("system-admin", "super-admin", "admin"), updateUser);
router.delete("/manage/:id", authenticate, authorizeRoles("system-admin", "super-admin", "admin"), deleteUser);

module.exports = router;
