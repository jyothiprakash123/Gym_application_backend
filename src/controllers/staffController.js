const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");
const { sanitizePhone, isValidPhone } = require("../utils/phoneValidation");

// ======================================================
// CREATE STAFF
// ======================================================

const createStaff = async (req, res, next) => {
  try {
    const {
      branchId,
      fullName,
      email,
      phone,
      designation,
      salary,
      joiningDate,
    } = req.body;

    if (!branchId || !fullName || !fullName.trim() || !phone) {
      return res.status(400).json({
        success: false,
        message: "Branch, full name and phone are required",
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

    const cleanPhone = sanitizePhone(phone);
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

    if (email && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid email address",
        });
      }
    }

    // 1. Validate branch ownership
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

    const branchGymId = branchResult.rows[0].gym_id;

    if (req.tenant?.gymId && branchGymId !== req.tenant.gymId) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this branch",
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
        message: "Cannot create staff in an inactive branch",
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
      return res.status(400).json({
        success: false,
        message: "A staff member with this phone number already exists in this gym",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO staff (
        branch_id,
        full_name,
        email,
        phone,
        designation,
        salary,
        joining_date
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7
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
        created_at,
        updated_at
      `,
      [
        branchId,
        fullName.trim(),
        email?.trim().toLowerCase() || null,
        cleanPhone,
        designation?.trim() || null,
        salary || null,
        joiningDate || null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Staff created successfully",
      data: {
        staff: result.rows[0],
      },
    });
  } catch (error) {
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

    let baseQuery = `FROM staff s LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN gyms g ON g.id = b.gym_id`;
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

    if (conditions.length > 0) {
      baseQuery += ` WHERE ` + conditions.join(" AND ");
    }

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
        s.full_name,
        s.email,
        s.phone,
        s.designation,
        s.salary,
        s.joining_date,
        s.is_active,
        s.created_at,
        s.updated_at
      ${baseQuery}
      ORDER BY s.created_at DESC
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
        s.full_name,
        s.email,
        s.phone,
        s.designation,
        s.salary,
        s.joining_date,
        s.is_active,
        s.created_at,
        s.updated_at
      FROM staff s
      LEFT JOIN branches b
        ON b.id = s.branch_id
      LEFT JOIN gyms g
        ON g.id = b.gym_id
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

    if (req.tenant?.branchId && staffCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update this staff member",
      });
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

      const targetGymId = (branchId !== undefined && branchId !== null && branchId !== staffCheck.rows[0].branch_id)
        ? (await pool.query("SELECT gym_id FROM branches WHERE id = $1", [branchId])).rows[0]?.gym_id
        : staffCheck.rows[0].gym_id;

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

    if (email !== undefined && email && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid email address",
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
        updated_at = NOW()
      WHERE id = $9::uuid
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
        email?.trim().toLowerCase() || null,
        cleanPhone !== undefined ? cleanPhone : null,
        designation?.trim() || null,
        salary ?? null,
        joiningDate ?? null,
        isActive ?? null,
        id,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Staff updated successfully",
      data: {
        staff: result.rows[0],
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
      SELECT s.id, b.gym_id, s.branch_id 
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
        full_name,
        email,
        phone,
        is_active,
        updated_at
      `,
      [id]
    );

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
  hardDeleteStaff,
};
