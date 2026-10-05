// ======================================================
// ROLE AUTHORIZATION MIDDLEWARE
// ======================================================

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    // authenticate middleware must run first
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const userRole = req.user.role_name;

    // Check whether user's role is allowed
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }

    next();
  };
};

module.exports = authorizeRoles;