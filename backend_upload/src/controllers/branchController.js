const pool = require("../config/db");

// ======================================================
// CREATE BRANCH
// ======================================================

const createBranch = async (req, res, next) => {
  try {
    const {
      gymId,
      managerId,
      name,
      address,
      city,
      phone,
      email,
      openingTime,
      closingTime,
    } = req.body;

    // ----------------------------------------------
    // 1. Validate required fields
    // ----------------------------------------------

    if (!gymId || !name) {
      return res.status(400).json({
        success: false,
        message: "gymId and name are required",
      });
    }

    // ----------------------------------------------
    // 2. Only Super Admin can create branches
    // ----------------------------------------------

    if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "Only super-admin can create branches",
      });
    }

    // ----------------------------------------------
    // 3. Verify gym exists
    // ----------------------------------------------

    const gymResult = await pool.query(
      `
      SELECT
        id,
        name,
        is_active
      FROM gyms
      WHERE id = $1
      LIMIT 1
      `,
      [gymId]
    );

    if (gymResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Gym not found",
      });
    }

    const gym = gymResult.rows[0];

    if (!gym.is_active) {
      return res.status(400).json({
        success: false,
        message: "Gym is inactive",
      });
    }

    // ----------------------------------------------
    // 4. Validate manager if provided
    // ----------------------------------------------

    if (managerId) {
      const managerResult = await pool.query(
        `
        SELECT
          u.id,
          u.full_name,
          u.is_active,
          r.name AS role_name
        FROM users u
        LEFT JOIN roles r
          ON r.id = u.role_id
        WHERE u.id = $1
        LIMIT 1
        `,
        [managerId]
      );

      if (managerResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Manager not found",
        });
      }

      const manager = managerResult.rows[0];

      if (!manager.is_active) {
        return res.status(400).json({
          success: false,
          message: "Manager account is inactive",
        });
      }

      if (manager.role_name !== "admin") {
        return res.status(400).json({
          success: false,
          message: "Branch manager must have admin role",
        });
      }
    }

    // ----------------------------------------------
    // 5. Create branch
    // ----------------------------------------------

    const branchResult = await pool.query(
      `
      INSERT INTO branches (
        gym_id,
        manager_id,
        name,
        address,
        city,
        phone,
        email,
        opening_time,
        closing_time
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9
      )
      RETURNING
        id,
        gym_id,
        manager_id,
        name,
        address,
        city,
        phone,
        email,
        opening_time,
        closing_time,
        is_active,
        created_at,
        updated_at
      `,
      [
        gymId,
        managerId || null,
        name.trim(),
        address || null,
        city || null,
        phone || null,
        email ? email.trim().toLowerCase() : null,
        openingTime || null,
        closingTime || null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Branch created successfully",
      data: {
        branch: branchResult.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ALL BRANCHES
// ======================================================

const getBranches = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const gymId = req.query.gymId;
    const offset = (page - 1) * limit;

    let baseQuery = `FROM branches b LEFT JOIN gyms g ON b.gym_id = g.id`;
    let countParams = [];
    let dataParams = [];
    let conditions = [];

    // Base Condition: Role Access
    if (req.user.role_name === "admin") {
      conditions.push(`b.manager_id = $${countParams.length + 1}`);
      countParams.push(req.user.id);
      dataParams.push(req.user.id);
    } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view branches",
      });
    }

    // Gym Filter Condition
    if (gymId) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(gymId);
      dataParams.push(gymId);
    }

    // Search Condition
    if (search) {
      const searchStr = `%${search}%`;
      const searchCondition = `(b.name ILIKE $${countParams.length + 1} OR b.city ILIKE $${countParams.length + 1} OR b.email ILIKE $${countParams.length + 1} OR b.phone ILIKE $${countParams.length + 1})`;
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
        b.id,
        b.gym_id,
        b.manager_id,
        b.name,
        b.address,
        b.city,
        b.phone,
        b.email,
        b.opening_time,
        b.closing_time,
        b.is_active,
        b.created_at,
        b.updated_at,
        g.name as gym_name
      ${baseQuery}
      ORDER BY b.created_at DESC
      ${limitOffsetCondition}
    `;

    const result = await pool.query(dataQuery, dataParams);

    return res.status(200).json({
      success: true,
      data: {
        branches: result.rows,
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
// GET SINGLE BRANCH
// ======================================================

const getBranchById = async (req, res, next) => {
  try {
    const { id } = req.params;

    let query;
    let params;

    if ((req.user.role_name === "system-admin" || req.user.role_name === "super-admin")) {
      query = `
        SELECT
          id,
          gym_id,
          manager_id,
          name,
          address,
          city,
          phone,
          email,
          opening_time,
          closing_time,
          is_active,
          created_at,
          updated_at
        FROM branches
        WHERE id = $1
        LIMIT 1
      `;

      params = [id];
    } else if (req.user.role_name === "admin") {
      query = `
        SELECT
          id,
          gym_id,
          manager_id,
          name,
          address,
          city,
          phone,
          email,
          opening_time,
          closing_time,
          is_active,
          created_at,
          updated_at
        FROM branches
        WHERE id = $1
          AND manager_id = $2
        LIMIT 1
      `;

      params = [id, req.user.id];
    } else {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view this branch",
      });
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        branch: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE BRANCH
// ======================================================

const updateBranch = async (req, res, next) => {
  try {
    const { id } = req.params;

    const {
      managerId,
      name,
      address,
      city,
      phone,
      email,
      openingTime,
      closingTime,
      isActive,
    } = req.body;

    // ----------------------------------------------
    // Find branch with access control
    // ----------------------------------------------

    let branchQuery;
    let branchParams;

    if ((req.user.role_name === "system-admin" || req.user.role_name === "super-admin")) {
      branchQuery = `
        SELECT id, gym_id
        FROM branches
        WHERE id = $1
        LIMIT 1
      `;

      branchParams = [id];
    } else if (req.user.role_name === "admin") {
      branchQuery = `
        SELECT id, gym_id
        FROM branches
        WHERE id = $1
          AND manager_id = $2
        LIMIT 1
      `;

      branchParams = [id, req.user.id];
    } else {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update branches",
      });
    }

    const branchResult = await pool.query(
      branchQuery,
      branchParams
    );

    if (branchResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    const branch = branchResult.rows[0];

    // ----------------------------------------------
    // Only Super Admin can change manager
    // ----------------------------------------------

    if (
      managerId !== undefined &&
      req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only super-admin can change branch manager",
      });
    }

    // ----------------------------------------------
    // Validate new manager
    // ----------------------------------------------

    if (managerId) {
      const managerResult = await pool.query(
        `
        SELECT
          u.id,
          u.is_active,
          r.name AS role_name
        FROM users u
        LEFT JOIN roles r
          ON r.id = u.role_id
        WHERE u.id = $1
        LIMIT 1
        `,
        [managerId]
      );

      if (managerResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Manager not found",
        });
      }

      const manager = managerResult.rows[0];

      if (manager.role_name !== "admin") {
        return res.status(400).json({
          success: false,
          message: "Branch manager must have admin role",
        });
      }

      if (!manager.is_active) {
        return res.status(400).json({
          success: false,
          message: "Manager account is inactive",
        });
      }
    }

    // ----------------------------------------------
    // Update
    // ----------------------------------------------

    const result = await pool.query(
      `
      UPDATE branches
      SET
        manager_id = COALESCE($1, manager_id),
        name = COALESCE($2, name),
        address = COALESCE($3, address),
        city = COALESCE($4, city),
        phone = COALESCE($5, phone),
        email = COALESCE($6, email),
        opening_time = COALESCE($7, opening_time),
        closing_time = COALESCE($8, closing_time),
        is_active = COALESCE($9, is_active),
        updated_at = NOW()
      WHERE id = $10
      RETURNING
        id,
        gym_id,
        manager_id,
        name,
        address,
        city,
        phone,
        email,
        opening_time,
        closing_time,
        is_active,
        created_at,
        updated_at
      `,
      [
        managerId,
        name ? name.trim() : null,
        address,
        city,
        phone,
        email ? email.trim().toLowerCase() : null,
        openingTime,
        closingTime,
        isActive,
        id,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Branch updated successfully",
      data: {
        branch: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DEACTIVATE BRANCH
// ======================================================

const deleteBranch = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "Only super-admin can deactivate branches",
      });
    }

    const result = await pool.query(
      `
      UPDATE branches
      SET
        is_active = false,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        gym_id,
        manager_id,
        name,
        is_active,
        updated_at
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Branch deactivated successfully",
      data: {
        branch: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// HARD DELETE BRANCH
// ======================================================

const hardDeleteBranch = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check permissions
    if (req.user.role_name === "admin") {
      const branchCheck = await pool.query(
        "SELECT id FROM branches WHERE id = $1 AND manager_id = $2",
        [id, req.user.id]
      );
      if (branchCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to delete this branch",
        });
      }
    } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete branches",
      });
    }

    const result = await pool.query(
      `
      DELETE FROM branches
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Branch deleted permanently",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBranch,
  getBranches,
  getBranchById,
  updateBranch,
  deleteBranch,
  hardDeleteBranch,
};