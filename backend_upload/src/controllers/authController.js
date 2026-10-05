const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const pool = require("../config/db");

const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utils/token");

// ======================================================
// COOKIE OPTIONS
// ======================================================

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

const accessCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 15 * 60 * 1000, // 15 minutes
  path: "/",
};

// ======================================================
// LOGIN
// ======================================================

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    console.log(email, password);

    // ----------------------------------------------
    // 1. Validate input
    // ----------------------------------------------

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email
      .trim()
      .toLowerCase();

    // ----------------------------------------------
    // 2. Find user
    // ----------------------------------------------

    const userQuery = `
      SELECT
        u.id,
        u.email,
        u.password_hash,
        u.full_name,
        u.phone,
        u.role_id,
        u.is_active,
        u.last_login,
        r.name AS role_name
      FROM users u
      LEFT JOIN roles r
        ON r.id = u.role_id
      WHERE LOWER(u.email) = $1
      LIMIT 1
    `;

    const userResult = await pool.query(
      userQuery,
      [normalizedEmail]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = userResult.rows[0];

    // ----------------------------------------------
    // 3. Check account
    // ----------------------------------------------

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated",
      });
    }

    // ----------------------------------------------
    // 4. Verify password
    // ----------------------------------------------

    const passwordMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // ----------------------------------------------
    // 5. Get gym
    // ----------------------------------------------

    const gymQuery = `
      SELECT
        id,
        name,
        logo_url,
        email,
        phone,
        city,
        state,
        country,
        is_active
      FROM gyms
      WHERE owner_id = $1
      LIMIT 1
    `;

    const gymResult = await pool.query(
      gymQuery,
      [user.id]
    );

    const gym = gymResult.rows[0] || null;

    // ----------------------------------------------
    // 6. Generate tokens
    // ----------------------------------------------

    const accessToken =
      generateAccessToken(user);

    const refreshToken =
      generateRefreshToken(user);

    // ----------------------------------------------
    // 7. Store refresh token
    // ----------------------------------------------

    await pool.query(
      `
      UPDATE users
      SET
        refresh_token = $1,
        last_login = NOW(),
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        refreshToken,
        user.id,
      ]
    );

    // ----------------------------------------------
    // 8. Set refresh cookie
    // ----------------------------------------------

    res.cookie(
      "refreshToken",
      refreshToken,
      refreshCookieOptions
    );
    
    res.cookie(
      "accessToken",
      accessToken,
      accessCookieOptions
    );

    // ----------------------------------------------
    // 9. Response
    // ----------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Login successful",

      data: {
        accessToken,

        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          phone: user.phone,

          role: {
            id: user.role_id,
            name: user.role_name,
          },
        },

        gym,
      },
    });

  } catch (error) {
    next(error);
  }
};

// ======================================================
// REFRESH ACCESS TOKEN
// ======================================================

const refreshToken = async (req, res, next) => {
  try {
    const token =
      req.cookies.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Refresh token not found",
      });
    }

    // ----------------------------------------------
    // 1. Verify refresh token
    // ----------------------------------------------

    const decoded = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET
    );

    // ----------------------------------------------
    // 2. Find user
    // ----------------------------------------------

    const userResult = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.phone,
        u.role_id,
        u.is_active,
        u.refresh_token,
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
        message: "User not found",
      });
    }

    const user = userResult.rows[0];

    // ----------------------------------------------
    // 3. Check account
    // ----------------------------------------------

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated",
      });
    }

    // ----------------------------------------------
    // 4. Compare stored refresh token
    // ----------------------------------------------

    if (
      !user.refresh_token ||
      user.refresh_token !== token
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // ----------------------------------------------
    // 5. Generate new tokens
    // ----------------------------------------------

    const newAccessToken =
      generateAccessToken(user);

    const newRefreshToken =
      generateRefreshToken(user);

    // ----------------------------------------------
    // 6. Rotate refresh token
    // ----------------------------------------------

    await pool.query(
      `
      UPDATE users
      SET
        refresh_token = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        newRefreshToken,
        user.id,
      ]
    );

    // ----------------------------------------------
    // 7. Set new cookie
    // ----------------------------------------------

    res.cookie(
      "refreshToken",
      newRefreshToken,
      refreshCookieOptions
    );

    res.cookie(
      "accessToken",
      newAccessToken,
      accessCookieOptions
    );

    return res.status(200).json({
      success: true,
      message: "Access token refreshed",

      data: {
        accessToken: newAccessToken,
      },
    });

  } catch (error) {

    if (
      error.name === "TokenExpiredError" ||
      error.name === "JsonWebTokenError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    next(error);
  }
};

// ======================================================
// LOGOUT
// ======================================================

const logout = async (req, res, next) => {
  try {
    const token =
      req.cookies.refreshToken;

    // ----------------------------------------------
    // Remove refresh token from database
    // ----------------------------------------------

    if (token) {
      await pool.query(
        `
        UPDATE users
        SET
          refresh_token = NULL,
          updated_at = NOW()
        WHERE refresh_token = $1
        `,
        [token]
      );
    }

    // ----------------------------------------------
    // Clear cookie
    // ----------------------------------------------

    res.clearCookie(
      "refreshToken",
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
      }
    );

    res.clearCookie(
      "accessToken",
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
      }
    );

    return res.status(200).json({
      success: true,
      message: "Logout successful",
    });

  } catch (error) {
    next(error);
  }
};

// ======================================================
// CURRENT USER
// ======================================================

const me = async (req, res) => {
  return res.status(200).json({
    success: true,

    data: {
      user: {
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.full_name,
        phone: req.user.phone,

        role: {
          id: req.user.role_id,
          name: req.user.role_name,
        },
      },
    },
  });
};

module.exports = {
  login,
  refreshToken,
  logout,
  me,
};