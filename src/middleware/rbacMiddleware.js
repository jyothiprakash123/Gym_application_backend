const { hasPermission, getAllowedRoles, PERMISSION_MATRIX } = require("../config/rbacConfig");

/**
 * Express middleware that enforces central RBAC permissions.
 *
 * @param {string} moduleName - Module identifier (e.g. 'members', 'plans', 'expenses')
 * @param {string} action - Action ('view' | 'create' | 'edit' | 'delete')
 * @returns {Function} Express middleware (req, res, next)
 *
 * Usage:
 *   router.get("/", requirePermission("members", "view"), getMembers);
 *   router.post("/", requirePermission("members", "create"), createMember);
 *   router.put("/:id", requirePermission("members", "edit"), updateMember);
 *   router.delete("/:id", requirePermission("members", "delete"), deleteMember);
 */
const requirePermission = (moduleName, action) => {
  return (req, res, next) => {
    // Authentication must run first
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const userRole = req.user.role_name;

    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "Access denied: User has no role assigned",
      });
    }

    if (!hasPermission(userRole, moduleName, action)) {
      return res.status(403).json({
        success: false,
        message: `You do not have permission to ${action} ${moduleName}`,
      });
    }

    next();
  };
};

module.exports = {
  requirePermission,
  hasPermission,
  getAllowedRoles,
  PERMISSION_MATRIX,
};
