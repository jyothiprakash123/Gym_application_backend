const pool = require("../config/db");

// ======================================================
// CREATE MEMBERSHIP PLAN
// ======================================================
const createPlan = async (req, res, next) => {
  try {
    const { branchId, name, description, durationDays, price, maxFreezeDays } = req.body;

    if (!branchId || !name || durationDays === undefined || price === undefined) {
      return res.status(400).json({
        success: false,
        message: "Branch ID, name, duration (days), and price are required",
      });
    }

    const branchResult = await pool.query(
      `
      SELECT id, is_active FROM branches WHERE id = $1 LIMIT 1
      `,
      [branchId]
    );

    if (branchResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO membership_plans (
        branch_id,
        name,
        description,
        duration_days,
        price,
        max_freeze_days
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        branchId,
        name.trim(),
        description ?? null,
        durationDays,
        price,
        maxFreezeDays ?? 0,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Membership plan created successfully",
      data: { plan: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ALL MEMBERSHIP PLANS
// ======================================================
const getPlans = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const branchId = req.query.branchId;
    const gymId = req.query.gymId;
    const offset = (page - 1) * limit;

    let baseQuery = `FROM membership_plans p LEFT JOIN branches b ON p.branch_id = b.id LEFT JOIN gyms g ON g.id = b.gym_id`;
    let countParams = [];
    let dataParams = [];
    let conditions = [];

    // Role-based access control (similar to members)
    if (req.user.role_name === "admin") {
      conditions.push(`b.manager_id = $${countParams.length + 1}`);
      countParams.push(req.user.id);
      dataParams.push(req.user.id);
    } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view membership plans",
      });
    }

    if (branchId) {
      conditions.push(`p.branch_id = $${countParams.length + 1}`);
      countParams.push(branchId);
      dataParams.push(branchId);
    } else if (gymId) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(gymId);
      dataParams.push(gymId);
    }

    if (search) {
      const searchStr = `%${search}%`;
      conditions.push(`p.name ILIKE $${countParams.length + 1}`);
      countParams.push(searchStr);
      dataParams.push(searchStr);
    }

    if (conditions.length > 0) {
      baseQuery += ` WHERE ` + conditions.join(" AND ");
    }

    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await pool.query(countQuery, countParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    dataParams.push(limit, offset);
    const limitOffsetCondition = ` LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;

    const dataQuery = `
      SELECT p.*, b.name AS branch_name, g.name AS gym_name
      ${baseQuery}
      ORDER BY p.created_at DESC
      ${limitOffsetCondition}
    `;

    const result = await pool.query(dataQuery, dataParams);

    return res.status(200).json({
      success: true,
      data: {
        plans: result.rows,
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
// GET MEMBERSHIP PLAN BY ID
// ======================================================
const getPlanById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT *
      FROM membership_plans
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Membership plan not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: { plan: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE MEMBERSHIP PLAN
// ======================================================
const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { branchId, name, description, durationDays, price, maxFreezeDays, isActive } = req.body;

    const planResult = await pool.query(`SELECT id FROM membership_plans WHERE id = $1 LIMIT 1`, [id]);
    if (planResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Membership plan not found" });
    }

    if (branchId) {
      const branchResult = await pool.query(`SELECT id FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
      if (branchResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Branch not found" });
      }
    }

    const result = await pool.query(
      `
      UPDATE membership_plans
      SET
        branch_id = COALESCE($1::uuid, branch_id),
        name = COALESCE($2::text, name),
        description = COALESCE($3::text, description),
        duration_days = COALESCE($4::integer, duration_days),
        price = COALESCE($5::numeric, price),
        max_freeze_days = COALESCE($6::integer, max_freeze_days),
        is_active = COALESCE($7::boolean, is_active),
        updated_at = NOW()
      WHERE id = $8::uuid
      RETURNING *
      `,
      [
        branchId ?? null,
        name?.trim() || null,
        description ?? null,
        durationDays ?? null,
        price ?? null,
        maxFreezeDays ?? null,
        isActive ?? null,
        id,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Membership plan updated successfully",
      data: { plan: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DEACTIVATE MEMBERSHIP PLAN
// ======================================================
const deletePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
      UPDATE membership_plans
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Membership plan not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Membership plan deactivated successfully",
      data: { plan: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// HARD DELETE MEMBERSHIP PLAN
// ======================================================
const hardDeletePlan = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete membership plans",
      });
    }

    const result = await pool.query(
      `DELETE FROM membership_plans WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Membership plan not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Membership plan deleted permanently",
    });
  } catch (error) {
    next(error);
  }
};


const exportPlans = async (req, res, next) => {
  try {
    const search = req.query.search || "";
    const branchId = req.query.branchId;
    const gymId = req.query.gymId;

    let baseQuery = `FROM membership_plans p LEFT JOIN branches b ON p.branch_id = b.id LEFT JOIN gyms g ON g.id = b.gym_id`;
    let dataParams = [];
    let conditions = [];

    if (req.user.role_name === "admin") {
      conditions.push(`b.manager_id = ${dataParams.length + 1}`);
      dataParams.push(req.user.id);
    }

    if (gymId) {
      conditions.push(`g.id = ${dataParams.length + 1}`);
      dataParams.push(gymId);
    }
    if (branchId) {
      conditions.push(`b.id = ${dataParams.length + 1}`);
      dataParams.push(branchId);
    }
    if (search) {
      conditions.push(`(p.name ILIKE ${dataParams.length + 1})`);
      dataParams.push(`%${search}%`);
    }

    let whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const query = `
      SELECT 
        p.id, p.name, p.duration_days, p.price, p.max_freeze_days, 
        CASE WHEN p.is_active THEN 'Active' ELSE 'Inactive' END as status,
        g.name as gym_name,
        b.name as branch_name
      ${baseQuery}
      ${whereClause}
      ORDER BY p.created_at DESC
    `;

    const { rows } = await pool.query(query, dataParams);
    if (!rows || rows.length === 0) {
      return res.status(404).send("No records found");
    }

    const headers = Object.keys(rows[0]).join(",");
    const csvRows = rows.map(row => Object.values(row).map(val => `"${val || ''}"`).join(","));
    const csvContent = [headers, ...csvRows].join("\n");

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="plans_export.csv"');
    res.send(csvContent);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  exportPlans,
  createPlan,
  getPlans,
  getPlanById,
  updatePlan,
  deletePlan,
  hardDeletePlan,
};
