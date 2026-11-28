const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");
const { sanitizePhone, isValidPhone } = require("../utils/phoneValidation");
const { appendCreatedAtDateFilter } = require("../utils/dateUtils");

const isStrongPassword = (pwd) => {
  if (!pwd || typeof pwd !== "string" || pwd.length < 8) return false;
  const hasUpper = /[A-Z]/.test(pwd);
  const hasLower = /[a-z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
  return hasUpper && hasLower && hasNumber && hasSpecial;
};

const normalizeStaffRole = (roleInput) => {
  if (!roleInput) return null;
  const s = String(roleInput).trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (s === "trainer") return "trainer";
  if (s === "front-desk" || s === "frontdesk") return "front-desk";
  if (s === "admin") return "admin";
  return null;
};

// ======================================================
// CREATE STAFF
// ======================================================

const createStaff = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      branchId,
      fullName,
      email,
      phone,
      role,
      roleId,
      roleName,
      password,
      designation,
      salary,
      joiningDate,
    } = req.body;

    // Required fields check
    if (!branchId || !fullName || !fullName.trim() || !phone || !email || !String(email).trim() || !password) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Branch, full name, phone, email, and password are required",
      });
    }

    if (salary !== undefined && salary !== null && salary !== "") {
      const numSalary = Number(salary);
      if (isNaN(numSalary) || numSalary < 0) {
        client.release();
        return res.status(400).json({
          success: false,
          message: "Salary cannot be negative",
        });
      }
    }

    // Phone validation
    const cleanPhone = sanitizePhone(phone);
    if (!cleanPhone || cleanPhone.length !== 10) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Phone number must be exactly 10 digits",
      });
    }
    if (!isValidPhone(cleanPhone)) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Phone number must be a valid 10-digit mobile number starting with 6, 7, 8, or 9",
      });
    }

    // Email format validation
    const cleanEmail = String(email).trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address",
      });
    }

    // Strong password validation
    if (!isStrongPassword(password)) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
      });
    }

    // Role assignment validation (Trainer, Front-desk, Admin)
    let matchedRole = null;
    const targetRoleId = roleId && typeof roleId === "string" && roleId.trim() !== "" ? roleId.trim() : null;
    if (targetRoleId) {
      const rRes = await pool.query("SELECT id, name FROM roles WHERE id::text = $1 LIMIT 1", [targetRoleId]);
      if (rRes.rows.length > 0) matchedRole = rRes.rows[0];
    }
    if (!matchedRole && (role || roleName || designation)) {
      const normRole = normalizeStaffRole(role || roleName || designation);
      if (normRole) {
        const rRes = await pool.query("SELECT id, name FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1", [normRole]);
        if (rRes.rows.length > 0) matchedRole = rRes.rows[0];
      }
    }
    if (!matchedRole || !["admin", "front-desk", "trainer"].includes(matchedRole.name.toLowerCase())) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Valid staff role is required (Admin, Front-desk, or Trainer)",
      });
    }

    // 1. Validate branch ownership & tenant isolation
    const branchResult = await pool.query(
      `
      SELECT
        id,
        gym_id,
        is_active
      FROM branches
      WHERE id = $1
      LIMIT 1
      `,
      [branchId]
    );

    if (branchResult.rows.length === 0) {
      client.release();
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    const branchGymId = branchResult.rows[0].gym_id;

    if (req.tenant?.gymId && branchGymId !== req.tenant.gymId) {
      client.release();
      return res.status(403).json({
        success: false,
        message: "You do not have access to this branch",
      });
    }

    if (req.tenant?.branchId && req.tenant.branchId !== branchId) {
      client.release();
      return res.status(403).json({
        success: false,
        message: "You do not have access to this branch",
      });
    }

    if (!branchResult.rows[0].is_active) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Cannot create staff in an inactive branch",
      });
    }

    // Unique email within the system (check users and staff)
    const existingUser = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [cleanEmail]
    );
    if (existingUser.rows.length > 0) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    const existingStaffEmail = await pool.query(
      `SELECT id FROM staff WHERE LOWER(email) = $1 LIMIT 1`,
      [cleanEmail]
    );
    if (existingStaffEmail.rows.length > 0) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "A staff member with this email already exists",
      });
    }

    // Reject duplicate phone numbers inside the same gym
    const dupStaff = await pool.query(
      `
      SELECT s.id
      FROM staff s
      JOIN branches b ON b.id = s.branch_id
      WHERE b.gym_id = $1 AND s.phone = $2
      LIMIT 1
      `,
      [branchGymId, cleanPhone]
    );

    if (dupStaff.rows.length > 0) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "A staff member with this phone number already exists in this gym",
      });
    }

    const finalDesignation = designation?.trim() || (
      matchedRole.name.toLowerCase() === "admin"
        ? "Admin"
        : matchedRole.name.toLowerCase() === "front-desk"
        ? "Front Desk"
        : "Trainer"
    );

    // Atomic transaction for login user & staff creation
    await client.query("BEGIN");

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 1. Insert login user into users table
    const userResult = await client.query(
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
        cleanEmail,
        passwordHash,
        fullName.trim(),
        cleanPhone,
        matchedRole.id,
        branchGymId,
        branchId,
      ]
    );
    const newUser = userResult.rows[0];

    // 2. Insert staff record
    const result = await client.query(
      `
      INSERT INTO staff (
        branch_id,
        user_id,
        role_id,
        full_name,
        email,
        phone,
        designation,
        salary,
        joining_date,
        is_active,
        created_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10
      )
      RETURNING
        id,
        branch_id,
        user_id,
        role_id,
        full_name,
        email,
        phone,
        designation,
        salary,
        joining_date,
        is_active,
        created_by,
        created_at,
        updated_at
      `,
      [
        branchId,
        newUser.id,
        matchedRole.id,
        fullName.trim(),
        cleanEmail,
        cleanPhone,
        finalDesignation,
        salary || null,
        joiningDate || null,
        req.user?.id || null,
      ]
    );
    const newStaff = result.rows[0];

    await client.query("COMMIT");
    client.release();

    return res.status(201).json({
      success: true,
      message: "Staff created successfully with login credentials",
      data: {
        staff: {
          ...newStaff,
          role_name: matchedRole.name,
        },
        user: {
          id: newUser.id,
          email: newUser.email,
          full_name: newUser.full_name,
          role_name: matchedRole.name,
        },
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    client.release();
    next(error);
  }
};

// ======================================================
// GET ALL STAFF
// ======================================================

const getStaff = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    let baseQuery = `FROM staff s LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN gyms g ON g.id = b.gym_id LEFT JOIN roles r ON r.id = s.role_id LEFT JOIN users cb ON cb.id = s.created_by`;
    let countParams = [];
    let dataParams = [];
    let conditions = [];

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(req.tenant.gymId);
      dataParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view staff",
      });
    }

    // Shared branch-access helper (Day 2 Prompt 2)
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      conditions.push(`s.branch_id = $${countParams.length + 1}`);
      countParams.push(branchAccess.branchId);
      dataParams.push(branchAccess.branchId);
    }

    if (req.query.branchId && branchAccess.type !== "BRANCH") {
      conditions.push(`s.branch_id = $${countParams.length + 1}`);
      countParams.push(req.query.branchId);
      dataParams.push(req.query.branchId);
    } else if (req.query.gymId && req.tenant?.isSystemAdmin) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(req.query.gymId);
      dataParams.push(req.query.gymId);
    }

    // Search Condition
    if (search) {
      const searchStr = `%${search}%`;
      const searchCondition = `(s.full_name ILIKE $${countParams.length + 1} OR s.email ILIKE $${countParams.length + 1} OR s.phone ILIKE $${countParams.length + 1})`;
      conditions.push(searchCondition);
      countParams.push(searchStr);
      dataParams.push(searchStr);
    }

    appendCreatedAtDateFilter(conditions, [countParams, dataParams], "s.created_at", req.query);

    if (conditions.length > 0) {
      baseQuery += ` WHERE ` + conditions.join(" AND ");
    }

    const ALLOWED_SORT_FIELDS = {
      full_name: "s.full_name",
      branch_name: "b.name",
      is_active: "s.is_active",
      created_at: "s.created_at",
    };
    const sortField = ALLOWED_SORT_FIELDS[req.query.sort_by] || "s.created_at";
    const sortDir = req.query.sort_dir === "asc" ? "ASC" : "DESC";

    // Total Count Query
    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await pool.query(countQuery, countParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    // Data Query
    dataParams.push(limit, offset);
    const limitOffsetCondition = ` LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;

    const dataQuery = `
      SELECT
        s.id,
        s.branch_id,
        b.name AS branch_name,
        b.gym_id,
        g.name AS gym_name,
        s.user_id,
        s.role_id,
        COALESCE(r.name, '') AS role_name,
        s.full_name,
        s.email,
        s.phone,
        s.designation,
        s.salary,
        s.joining_date,
        s.is_active,
        s.created_by,
        cb.full_name AS created_by_name,
        s.created_at,
        s.updated_at
      ${baseQuery}
      ORDER BY ${sortField} ${sortDir}
      ${limitOffsetCondition}
    `;

    const result = await pool.query(dataQuery, dataParams);

    return res.status(200).json({
      success: true,
      data: {
        staff: result.rows,
        pagination: {
          totalItems,
          totalPages,
          currentPage: page,
          limit,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET STAFF BY ID
// ======================================================

const getStaffById = async (req, res, next) => {
  try {
    const { id } = req.params;

    let query = `
      SELECT
        s.id,
        s.branch_id,
        b.name AS branch_name,
        b.gym_id,
        g.name AS gym_name,
        s.user_id,
        s.role_id,
        COALESCE(r.name, '') AS role_name,
        s.full_name,
        s.email,
        s.phone,
        s.designation,
        s.salary,
        s.joining_date,
        s.is_active,
        s.created_by,
        cb.full_name AS created_by_name,
        s.created_at,
        s.updated_at
      FROM staff s
      LEFT JOIN branches b
        ON b.id = s.branch_id
      LEFT JOIN gyms g
        ON g.id = b.gym_id
      LEFT JOIN roles r
        ON r.id = s.role_id
      WHERE s.id = $1
    `;
    const params = [id];

    if (req.tenant?.gymId) {
      params.push(req.tenant.gymId);
      query += ` AND b.gym_id = $${params.length}`;
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view staff",
      });
    }

    // Shared branch-access helper (Day 2 Prompt 2)
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      params.push(branchAccess.branchId);
      query += ` AND s.branch_id = $${params.length}`;
    }

    query += ` LIMIT 1`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        staff: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE STAFF
// ======================================================

const updateStaff = async (req, res, next) => {
  try {
    const { id } = req.params;

    const {
      branchId,
      fullName,
      email,
      phone,
      role,
      roleId,
      roleName,
      password,
      designation,
      salary,
      joiningDate,
      isActive,
    } = req.body;

    // Check staff existence and gym ownership
    const staffCheck = await pool.query(
      `
      SELECT
        s.id,
        s.branch_id,
        s.user_id,
        s.role_id,
        b.gym_id
      FROM staff s
      JOIN branches b ON b.id = s.branch_id
      WHERE s.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (
      staffCheck.rows.length === 0 ||
      (req.tenant?.gymId && staffCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    const currentStaff = staffCheck.rows[0];

    if (fullName !== undefined && (!fullName || !fullName.trim())) {
      return res.status(400).json({
        success: false,
        message: "Full name is required",
      });
    }

    if (salary !== undefined && salary !== null && salary !== "") {
      const numSalary = Number(salary);
      if (isNaN(numSalary) || numSalary < 0) {
        return res.status(400).json({
          success: false,
          message: "Salary cannot be negative",
        });
      }
    }

    if (req.tenant?.branchId && currentStaff.branch_id !== req.tenant.branchId) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update this staff member",
      });
    }

    // Role assignment validation if provided
    let matchedRole = null;
    if (roleId && typeof roleId === "string" && roleId.trim() !== "") {
      const rRes = await pool.query("SELECT id, name FROM roles WHERE id::text = $1 LIMIT 1", [roleId.trim()]);
      if (rRes.rows.length > 0) matchedRole = rRes.rows[0];
    }
    if (!matchedRole && (role || roleName)) {
      const normRole = normalizeStaffRole(role || roleName);
      if (normRole) {
        const rRes = await pool.query("SELECT id, name FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1", [normRole]);
        if (rRes.rows.length > 0) matchedRole = rRes.rows[0];
      }
    }
    if ((role || roleId || roleName) && (!matchedRole || !["admin", "front-desk", "trainer"].includes(matchedRole.name.toLowerCase()))) {
      return res.status(400).json({
        success: false,
        message: "Valid staff role is required (Admin, Front-desk, or Trainer)",
      });
    }

    // Password validation if provided
    let updatedPasswordHash = null;
    if (password && String(password).trim() !== "") {
      if (!isStrongPassword(password)) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character",
        });
      }
      const salt = await bcrypt.genSalt(10);
      updatedPasswordHash = await bcrypt.hash(password, salt);
    }

    // Validate new branch if provided
    if (branchId !== undefined && branchId !== null) {
      const branchResult = await pool.query(
        `
        SELECT
          id,
          gym_id,
          is_active
        FROM branches
        WHERE id = $1
        LIMIT 1
        `,
        [branchId]
      );

      if (branchResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Branch not found",
        });
      }

      if (req.tenant?.gymId && branchResult.rows[0].gym_id !== req.tenant.gymId) {
        return res.status(403).json({
          success: false,
          message: "Target branch belongs to another gym",
        });
      }

      if (req.tenant?.branchId && req.tenant.branchId !== branchId) {
        return res.status(403).json({
          success: false,
          message: "You do not have access to this branch",
        });
      }

      if (!branchResult.rows[0].is_active) {
        return res.status(400).json({
          success: false,
          message: "Cannot move staff to an inactive branch",
        });
      }
    }

    let cleanPhone = undefined;
    if (phone !== undefined && phone !== null) {
      cleanPhone = sanitizePhone(phone);
      if (!cleanPhone || cleanPhone.length !== 10) {
        return res.status(400).json({
          success: false,
          message: "Phone number must be exactly 10 digits",
        });
      }
      if (!isValidPhone(cleanPhone)) {
        return res.status(400).json({
          success: false,
          message: "Phone number must be a valid 10-digit mobile number starting with 6, 7, 8, or 9",
        });
      }

      const targetGymId = (branchId !== undefined && branchId !== null && branchId !== currentStaff.branch_id)
        ? (await pool.query("SELECT gym_id FROM branches WHERE id = $1", [branchId])).rows[0]?.gym_id
        : currentStaff.gym_id;

      if (targetGymId) {
        const dupStaff = await pool.query(
          `
          SELECT s.id
          FROM staff s
          JOIN branches b ON b.id = s.branch_id
          WHERE b.gym_id = $1 AND s.phone = $2 AND s.id != $3
          LIMIT 1
          `,
          [targetGymId, cleanPhone, id]
        );

        if (dupStaff.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message: "A staff member with this phone number already exists in this gym",
          });
        }
      }
    }

    let cleanEmail = undefined;
    if (email !== undefined && email && email.trim()) {
      cleanEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid email address",
        });
      }

      // Check unique in users (excluding this user)
      const dupUser = await pool.query(
        `SELECT id FROM users WHERE LOWER(email) = $1 AND id != COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1`,
        [cleanEmail, currentStaff.user_id]
      );
      if (dupUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "A user with this email already exists",
        });
      }

      // Check unique in staff (excluding this staff)
      const dupStaffEmail = await pool.query(
        `SELECT id FROM staff WHERE LOWER(email) = $1 AND id != $2 LIMIT 1`,
        [cleanEmail, id]
      );
      if (dupStaffEmail.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "A staff member with this email already exists",
        });
      }
    }

    // Update staff
    const result = await pool.query(
      `
      UPDATE staff
      SET
        branch_id = COALESCE($1::uuid, branch_id),
        full_name = COALESCE($2::text, full_name),
        email = COALESCE($3::text, email),
        phone = COALESCE($4::text, phone),
        designation = COALESCE($5::text, designation),
        salary = COALESCE($6::numeric, salary),
        joining_date = COALESCE($7::date, joining_date),
        is_active = COALESCE($8::boolean, is_active),
        role_id = COALESCE($9::uuid, role_id),
        updated_at = NOW()
      WHERE id = $10::uuid
      RETURNING
        id,
        branch_id,
        user_id,
        role_id,
        full_name,
        email,
        phone,
        designation,
        salary,
        joining_date,
        is_active,
        created_at,
        updated_at
      `,
      [
        branchId ?? null,
        fullName?.trim() || null,
        cleanEmail || null,
        cleanPhone !== undefined ? cleanPhone : null,
        designation?.trim() || null,
        salary ?? null,
        joiningDate ?? null,
        isActive ?? null,
        matchedRole ? matchedRole.id : null,
        id,
      ]
    );

    // Sync corresponding user record if linked
    if (currentStaff.user_id) {
      await pool.query(
        `
        UPDATE users
        SET
          branch_id = COALESCE($1::uuid, branch_id),
          full_name = COALESCE($2::text, full_name),
          email = COALESCE($3::text, email),
          phone = COALESCE($4::text, phone),
          role_id = COALESCE($5::uuid, role_id),
          is_active = COALESCE($6::boolean, is_active),
          password_hash = COALESCE($7::text, password_hash),
          updated_at = NOW()
        WHERE id = $8::uuid
        `,
        [
          branchId ?? null,
          fullName?.trim() || null,
          cleanEmail || null,
          cleanPhone !== undefined ? cleanPhone : null,
          matchedRole ? matchedRole.id : null,
          isActive ?? null,
          updatedPasswordHash,
          currentStaff.user_id,
        ]
      );

      if (isActive === false) {
        await pool.query(
          `UPDATE users SET refresh_token = NULL WHERE id = $1`,
          [currentStaff.user_id]
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "Staff updated successfully",
      data: {
        staff: {
          ...result.rows[0],
          role_name: matchedRole ? matchedRole.name : undefined,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DEACTIVATE STAFF
// ======================================================

const deleteStaff = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check staff existence and gym ownership
    const staffCheck = await pool.query(
      `
      SELECT s.id, b.gym_id, s.branch_id, s.user_id 
      FROM staff s 
      JOIN branches b ON b.id = s.branch_id 
      WHERE s.id = $1 LIMIT 1
      `,
      [id]
    );

    if (
      staffCheck.rows.length === 0 ||
      (req.tenant?.gymId && staffCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    if (req.tenant?.branchId && staffCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to deactivate this staff member",
      });
    }

    const result = await pool.query(
      `
      UPDATE staff
      SET
        is_active = false,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        branch_id,
        user_id,
        full_name,
        email,
        phone,
        is_active,
        updated_at
      `,
      [id]
    );

    // Deactivate linked user login and invalidate refresh session
    if (staffCheck.rows[0].user_id) {
      await pool.query(
        `UPDATE users SET is_active = false, refresh_token = NULL, updated_at = NOW() WHERE id = $1`,
        [staffCheck.rows[0].user_id]
      );
    }

    return res.status(200).json({
      success: true,
      message: "Staff deactivated successfully",
      data: {
        staff: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// TOGGLE STAFF ACTIVE STATUS (BLOCKS LOGIN WHEN INACTIVE)
// ======================================================

const toggleStaffStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    // Check staff existence and gym ownership
    const staffCheck = await pool.query(
      `
      SELECT s.id, b.gym_id, s.branch_id, s.user_id, s.is_active, s.full_name, s.email, r.name AS role_name
      FROM staff s
      JOIN branches b ON b.id = s.branch_id
      LEFT JOIN roles r ON r.id = s.role_id
      WHERE s.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (
      staffCheck.rows.length === 0 ||
      (req.tenant?.gymId && staffCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    if (req.tenant?.branchId && staffCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to modify this staff member",
      });
    }

    const currentStaff = staffCheck.rows[0];
    const newActiveState = typeof isActive === "boolean" ? isActive : !currentStaff.is_active;

    // Update staff record
    const result = await pool.query(
      `
      UPDATE staff
      SET
        is_active = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING
        id,
        branch_id,
        user_id,
        full_name,
        email,
        phone,
        designation,
        is_active,
        updated_at
      `,
      [newActiveState, id]
    );

    // Sync linked user login account
    if (currentStaff.user_id) {
      if (!newActiveState) {
        // Deactivated: block login and invalidate active refresh session
        await pool.query(
          `
          UPDATE users
          SET
            is_active = false,
            refresh_token = NULL,
            updated_at = NOW()
          WHERE id = $1
          `,
          [currentStaff.user_id]
        );
      } else {
        // Reactivated: allow login
        await pool.query(
          `
          UPDATE users
          SET
            is_active = true,
            updated_at = NOW()
          WHERE id = $1
          `,
          [currentStaff.user_id]
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: newActiveState ? "Staff activated successfully" : "Staff deactivated successfully",
      data: {
        staff: {
          ...result.rows[0],
          role_name: currentStaff.role_name,
        },
        isActive: newActiveState,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// HARD DELETE STAFF
// ======================================================

const hardDeleteStaff = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete staff",
      });
    }

    // Check staff existence and gym ownership
    const staffCheck = await pool.query(
      `
      SELECT s.id, b.gym_id 
      FROM staff s 
      JOIN branches b ON b.id = s.branch_id 
      WHERE s.id = $1 LIMIT 1
      `,
      [id]
    );

    if (
      staffCheck.rows.length === 0 ||
      (req.tenant?.gymId && staffCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    const result = await pool.query(
      `
      DELETE FROM staff
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    return res.status(200).json({
      success: true,
      message: "Staff deleted permanently",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createStaff,
  getStaff,
  getStaffById,
  updateStaff,
  deleteStaff,
  toggleStaffStatus,
  hardDeleteStaff,
};
