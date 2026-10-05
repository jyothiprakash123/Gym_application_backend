const jwt = require("jsonwebtoken");

// ======================================================
// ACCESS TOKEN
// ======================================================

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      roleId: user.role_id,
      roleName: user.role_name,
    },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn:
        process.env.ACCESS_TOKEN_EXPIRES_IN || "15m",
    }
  );
};

// ======================================================
// REFRESH TOKEN
// ======================================================

const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
    },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn:
        process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
    }
  );
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
};