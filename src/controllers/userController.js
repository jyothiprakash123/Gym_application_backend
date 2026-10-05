const pool = require("../config/db");
const bcrypt = require("bcryptjs");

// ======================================================
// GET ROLES
// ======================================================

const getRoles = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description FROM roles ORDER BY created_at ASC`
    );

    let allowedRoles = [];
    const roleName = req.user.role_name;

    if (roleName === "system-admin") {
      allowedRoles = ["super-admin", "admin", "trainer", "front-desk", "accountant"];
    } else if (roleName === "super-admin") {
      allowedRoles = ["admin", "trainer", "front-desk", "accountant"];
    } else if (roleName === "admin") {
      allowedRoles = ["trainer", "front-desk", "accountant"];
    }

    const filteredRoles = result.rows.filter(r => allowedRoles.includes(r.name));

    return res.status(200).json({
      success: true,
      data: {
        roles: filteredRoles,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE PROFILE
// ======================================================

const updateProfile = async (req, res, next) => {
  try {
    const { id } = req.user;
    const { fullName, email, phone, password, role_id } = req.body;

    let updateQuery = `
      UPDATE users
      SET
        full_name = COALESCE($1::text, full_name),
        email = COALESCE($2::text, email),
        phone = COALESCE($3::text, phone),
        role_id = COALESCE($4::uuid, role_id),
        updated_at = NOW()
    `;
    let queryParams = [
      fullName?.trim() || null,
      email?.trim().toLowerCase() || null,
      phone?.trim() || null,
      role_id || null,
    ];

    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      updateQuery += `, password_hash = $5::text`;
      queryParams.push(hashedPassword);
      updateQuery += ` WHERE id = $6::uuid RETURNING *`;
      queryParams.push(id);
    } else {
      updateQuery += ` WHERE id = $5::uuid RETURNING *`;
      queryParams.push(id);
    }

    const result = await pool.query(updateQuery, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const updatedUser = result.rows[0];

    // If the user is also a member, we might want to update the members table as well
    // but the main issue is that the profile edit form only updates local storage.
    // This updates the users table.

    // Return the updated user info without password hash
    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user: {
          id: updatedUser.id,
          fullName: updatedUser.full_name,
          email: updatedUser.email,
          phone: updatedUser.phone,
          role_id: updatedUser.role_id,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ALL USERS (SYSTEM ADMIN)
// ======================================================

const getAllUsers = async (req, res, next) => {
  try {
    const roleName = req.user.role_name;
    let query = `SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.created_at, u.role_id, u.gym_id, u.branch_id, r.name as role_name, r.description as role_description 
       FROM users u 
       LEFT JOIN roles r ON u.role_id = r.id 
       WHERE 1=1 `;
    let queryParams = [];

    if (roleName === "super-admin") {
      // Super Admin sees users in their gym
      query += ` AND u.gym_id = $1 AND r.name != 'system-admin' `;
      queryParams.push(req.user.gym_id);
    } else if (roleName === "admin") {
      // Admin sees users in their branch
      query += ` AND u.branch_id = $1 AND r.name NOT IN ('system-admin', 'super-admin') `;
      queryParams.push(req.user.branch_id);
    } else if (roleName === "system-admin") {
      // System admin sees all
    } else {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    query += ` ORDER BY u.created_at DESC`;

    const result = await pool.query(query, queryParams);
    return res.status(200).json({
      success: true,
      data: {
        users: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// CREATE USER (SYSTEM ADMIN)
// ======================================================

const createUser = async (req, res, next) => {
  try {
    const { fullName, email, phone, role_id, password, gym_id, branch_id } = req.body;

    if (!fullName || !email || !role_id || !password) {
      return res.status(400).json({
        success: false,
        message: "Full name, email, role, and password are required",
      });
    }

    const existingUser = await pool.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User with this email already exists",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Set appropriate gym_id and branch_id based on creator's role
    let finalGymId = gym_id || null;
    let finalBranchId = branch_id || null;

    if (req.user.role_name === "super-admin") {
      finalGymId = req.user.gym_id; // inherit super-admin's gym
    } else if (req.user.role_name === "admin") {
      finalGymId = req.user.gym_id; // inherit admin's gym
      finalBranchId = req.user.branch_id; // inherit admin's branch
    }

    const result = await pool.query(
      `
      INSERT INTO users (
        email,
        password_hash,
        full_name,
        phone,
        role_id,
        gym_id,
        branch_id,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      RETURNING id, email, full_name, phone, role_id, gym_id, branch_id, is_active, created_at
      `,
      [
        email.trim().toLowerCase(),
        hashedPassword,
        fullName.trim(),
        phone?.trim() || null,
        role_id,
        finalGymId,
        finalBranchId
      ]
    );

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      data: {
        user: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE USER (SYSTEM ADMIN)
// ======================================================

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fullName, email, phone, role_id, password, is_active, gym_id, branch_id } = req.body;

    // Determine gym_id and branch_id to update based on role
    let finalGymId = gym_id !== undefined ? gym_id : null;
    let finalBranchId = branch_id !== undefined ? branch_id : null;

    if (req.user.role_name === "super-admin") {
      finalGymId = req.user.gym_id;
    } else if (req.user.role_name === "admin") {
      finalGymId = req.user.gym_id;
      finalBranchId = req.user.branch_id;
    }

    let updateQuery = `
      UPDATE users
      SET
        full_name = COALESCE($1::text, full_name),
        email = COALESCE($2::text, email),
        phone = COALESCE($3::text, phone),
        role_id = COALESCE($4::uuid, role_id),
        is_active = COALESCE($5::boolean, is_active),
        gym_id = COALESCE($6::uuid, gym_id),
        branch_id = COALESCE($7::uuid, branch_id),
        updated_at = NOW()
    `;
    let queryParams = [
      fullName?.trim() || null,
      email?.trim().toLowerCase() || null,
      phone?.trim() || null,
      role_id || null,
      is_active !== undefined ? is_active : null,
      finalGymId,
      finalBranchId
    ];

    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      updateQuery += `, password_hash = $8::text`;
      queryParams.push(hashedPassword);
      updateQuery += ` WHERE id = $9::uuid RETURNING *`;
      queryParams.push(id);
    } else {
      updateQuery += ` WHERE id = $8::uuid RETURNING *`;
      queryParams.push(id);
    }

    const result = await pool.query(updateQuery, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: {
        user: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE USER (SYSTEM ADMIN)
// ======================================================

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  updateProfile,
  getRoles,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
};
