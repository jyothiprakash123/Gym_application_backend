const jwt = require("jsonwebtoken");
const pool = require("../config/db");

// ======================================================
// AUTHENTICATION MIDDLEWARE
// ======================================================

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = req.cookies?.accessToken || (authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null);

    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // ----------------------------------------------
    // 3. Verify token
    // ----------------------------------------------

    const decoded = jwt.verify(
      accessToken,
      process.env.JWT_ACCESS_SECRET
    );

    // ----------------------------------------------
    // 4. Get current user
    // ----------------------------------------------

    const userResult = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.phone,
        u.role_id,
        u.gym_id,
        u.branch_id,
        u.is_active,
        r.name AS role_name
      FROM users u
      LEFT JOIN roles r
        ON r.id = u.role_id
      WHERE u.id = $1
      LIMIT 1
      `,
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    const user = userResult.rows[0];

    // ----------------------------------------------
    // 5. Check account status
    // ----------------------------------------------

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated",
      });
    }

    // ----------------------------------------------
    // 6. Attach user and tenant context to request
    // ----------------------------------------------

    req.user = user;

    // Non-system-admin accounts must belong to a gym
    if (user.role_name !== "system-admin" && !user.gym_id) {
      return res.status(403).json({
        success: false,
        message: "Your account is not associated with any gym",
      });
    }

    const { resolveTenant } = require("./tenantMiddleware");
    req.tenant = resolveTenant(req);

    next();

  } catch (error) {

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Access token expired",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid access token",
      });
    }

    next(error);
  }
};

module.exports = authenticate;