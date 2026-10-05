const pool = require("../config/db");

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

    if (!branchId || !fullName || !phone) {
      return res.status(400).json({
        success: false,
        message: "Branch, full name and phone are required",
      });
    }

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

    if (!branchResult.rows[0].is_active) {
      return res.status(400).json({
        success: false,
        message: "Cannot create staff in an inactive branch",
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
        phone.trim(),
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

    // Role-based access control
    // Super-admin sees all staff.
    // Admin sees staff of branches they manage.
    if (req.user.role_name === "admin") {
      conditions.push(`b.manager_id = $${countParams.length + 1}`);
      countParams.push(req.user.id);
      dataParams.push(req.user.id);
    } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view staff",
      });
    }

    if (req.query.gymId) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(req.query.gymId);
      dataParams.push(req.query.gymId);
    }

    if (req.query.branchId) {
      conditions.push(`b.id = $${countParams.length + 1}`);
      countParams.push(req.query.branchId);
      dataParams.push(req.query.branchId);
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

    const result = await pool.query(
      `
      SELECT
        s.id,
        s.branch_id,
        b.name AS branch_name,
        b.gym_id,
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
      WHERE s.id = $1
      LIMIT 1
      `,
      [id]
    );

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

    // Check staff
    const staffResult = await pool.query(
      `
      SELECT
        id,
        branch_id
      FROM staff
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (staffResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

    // Validate new branch if provided
    if (branchId !== undefined) {
      const branchResult = await pool.query(
        `
        SELECT
          id,
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

      if (!branchResult.rows[0].is_active) {
        return res.status(400).json({
          success: false,
          message: "Cannot move staff to an inactive branch",
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
        phone?.trim() || null,
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

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
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
// HARD DELETE STAFF
// ======================================================

const hardDeleteStaff = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check permissions
    if (req.user.role_name === "admin") {
      const branchCheck = await pool.query(
        `
        SELECT s.id 
        FROM staff s
        JOIN branches b ON b.id = s.branch_id
        WHERE s.id = $1 AND b.manager_id = $2
        `,
        [id, req.user.id]
      );
      if (branchCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to delete this staff",
        });
      }
    } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete staff",
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

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Staff not found",
      });
    }

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
