const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");

// ======================================================
// ROLE PERMISSION CONSTANTS FOR MEMBERSHIP PLANS
// ======================================================
const ALLOWED_READ_ROLES = ["system-admin", "super-admin", "admin", "front-desk"];
const ALLOWED_MUTATE_ROLES = ["system-admin", "super-admin", "admin"];

// ======================================================
// CREATE MEMBERSHIP PLAN
// ======================================================
const createPlan = async (req, res, next) => {
  try {
    if (!ALLOWED_MUTATE_ROLES.includes(req.user?.role_name)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to create membership plans",
      });
    }

    const { branchId, name, description, durationDays, price, maxFreezeDays, freezeFee } = req.body;

    if (!branchId || !name || !name.trim() || durationDays === undefined || price === undefined) {
      return res.status(400).json({
        success: false,
        message: "Branch ID, name, duration (days), and price are required",
      });
    }

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Plan price cannot be negative",
      });
    }

    const numDuration = parseInt(durationDays, 10);
    if (isNaN(numDuration) || numDuration <= 0) {
      return res.status(400).json({
        success: false,
        message: "Plan duration must be at least 1 day",
      });
    }

    const numFreezeFee = freezeFee !== undefined && freezeFee !== null ? Number(freezeFee) : 0;
    if (isNaN(numFreezeFee) || numFreezeFee < 0) {
      return res.status(400).json({
        success: false,
        message: "Freeze fee cannot be negative",
      });
    }

    // 1. Validate branch ownership
    const branchResult = await pool.query(
      `
      SELECT id, gym_id, is_active FROM branches WHERE id = $1 LIMIT 1
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
        message: "Cannot create plan in an inactive branch",
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
        max_freeze_days,
        freeze_fee
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        branchId,
        name.trim(),
        description ?? null,
        durationDays,
        price,
        maxFreezeDays ?? 0,
        numFreezeFee,
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
    if (!ALLOWED_READ_ROLES.includes(req.user?.role_name)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view membership plans",
      });
    }

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

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(req.tenant.gymId);
      dataParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view membership plans",
      });
    }

    // Shared branch-access helper (Day 2 Prompt 2)
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      conditions.push(`p.branch_id = $${countParams.length + 1}`);
      countParams.push(branchAccess.branchId);
      dataParams.push(branchAccess.branchId);
    }

    if (branchId && branchAccess.type !== "BRANCH") {
      conditions.push(`p.branch_id = $${countParams.length + 1}`);
      countParams.push(branchId);
      dataParams.push(branchId);
    } else if (gymId && req.tenant?.isSystemAdmin) {
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

    const statsQuery = `
      SELECT 
        COUNT(*)::int AS total_items,
        COUNT(CASE WHEN p.is_active = true THEN 1 END)::int AS active_items
      ${baseQuery}
    `;
    const statsResult = await pool.query(statsQuery, countParams);
    const totalItems = parseInt(statsResult.rows[0]?.total_items, 10) || 0;
    const activePlans = parseInt(statsResult.rows[0]?.active_items, 10) || 0;
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
        stats: {
          totalPlans: totalItems,
          activePlans,
        },
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
    if (!ALLOWED_READ_ROLES.includes(req.user?.role_name)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view membership plans",
      });
    }

    const { id } = req.params;

    let query = `
      SELECT p.*, b.name AS branch_name, b.gym_id, g.name AS gym_name
      FROM membership_plans p
      LEFT JOIN branches b ON p.branch_id = b.id
      LEFT JOIN gyms g ON g.id = b.gym_id
      WHERE p.id = $1
    `;
    const params = [id];

    if (req.tenant?.gymId) {
      params.push(req.tenant.gymId);
      query += ` AND b.gym_id = $${params.length}`;
    }

    if (req.tenant?.branchId) {
      params.push(req.tenant.branchId);
      query += ` AND p.branch_id = $${params.length}`;
    }

    query += ` LIMIT 1`;

    const result = await pool.query(query, params);

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
    if (!ALLOWED_MUTATE_ROLES.includes(req.user?.role_name)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update membership plans",
      });
    }

    const { id } = req.params;
    const { branchId, name, description, durationDays, price, maxFreezeDays, freezeFee, isActive } = req.body;

    // Verify plan exists and belongs to tenant gym
    const planCheck = await pool.query(
      `SELECT p.id, b.gym_id, p.branch_id 
       FROM membership_plans p 
       JOIN branches b ON b.id = p.branch_id 
       WHERE p.id = $1 LIMIT 1`,
      [id]
    );

    if (
      planCheck.rows.length === 0 ||
      (req.tenant?.gymId && planCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({ success: false, message: "Membership plan not found" });
    }

    if (req.tenant?.branchId && planCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this plan" });
    }

    if (branchId) {
      const branchResult = await pool.query(`SELECT id, gym_id FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
      if (branchResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Branch not found" });
      }
      if (req.tenant?.gymId && branchResult.rows[0].gym_id !== req.tenant.gymId) {
        return res.status(403).json({ success: false, message: "Branch does not belong to your gym" });
      }
      if (req.tenant?.branchId && req.tenant.branchId !== branchId) {
        return res.status(403).json({ success: false, message: "You do not have access to this branch" });
      }
    }

    if (name !== undefined && (!name || !name.trim())) {
      return res.status(400).json({
        success: false,
        message: "Plan name is required",
      });
    }

    if (price !== undefined && price !== null && price !== "") {
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 0) {
        return res.status(400).json({
          success: false,
          message: "Plan price cannot be negative",
        });
      }
    }

    if (durationDays !== undefined && durationDays !== null && durationDays !== "") {
      const numDuration = parseInt(durationDays, 10);
      if (isNaN(numDuration) || numDuration <= 0) {
        return res.status(400).json({
          success: false,
          message: "Plan duration must be at least 1 day",
        });
      }
    }

    if (freezeFee !== undefined && freezeFee !== null && freezeFee !== "") {
      const numFee = Number(freezeFee);
      if (isNaN(numFee) || numFee < 0) {
        return res.status(400).json({
          success: false,
          message: "Freeze fee cannot be negative",
        });
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
        freeze_fee = COALESCE($7::numeric, freeze_fee),
        is_active = COALESCE($8::boolean, is_active),
        updated_at = NOW()
      WHERE id = $9::uuid
      RETURNING *
      `,
      [
        branchId ?? null,
        name?.trim() || null,
        description ?? null,
        durationDays ?? null,
        price ?? null,
        maxFreezeDays ?? null,
        freezeFee !== undefined && freezeFee !== null && freezeFee !== "" ? Number(freezeFee) : null,
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
    if (!ALLOWED_MUTATE_ROLES.includes(req.user?.role_name)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to deactivate membership plans",
      });
    }

    const { id } = req.params;

    // Verify plan exists and belongs to tenant gym
    const planCheck = await pool.query(
      `SELECT p.id, b.gym_id, p.branch_id 
       FROM membership_plans p 
       JOIN branches b ON b.id = p.branch_id 
       WHERE p.id = $1 LIMIT 1`,
      [id]
    );

    if (
      planCheck.rows.length === 0 ||
      (req.tenant?.gymId && planCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({ success: false, message: "Membership plan not found" });
    }

    if (req.tenant?.branchId && planCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this plan" });
    }

    const result = await pool.query(
      `
      UPDATE membership_plans
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

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

    if (req.user?.role_name !== "system-admin" && req.user?.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete membership plans",
      });
    }

    // Verify plan exists and belongs to tenant gym
    const planCheck = await pool.query(
      `SELECT p.id, b.gym_id, p.branch_id 
       FROM membership_plans p 
       JOIN branches b ON b.id = p.branch_id 
       WHERE p.id = $1 LIMIT 1`,
      [id]
    );

    if (
      planCheck.rows.length === 0 ||
      (req.tenant?.gymId && planCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({ success: false, message: "Membership plan not found" });
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

// ======================================================
// EXPORT MEMBERSHIP PLANS
// ======================================================
const exportPlans = async (req, res, next) => {
  try {
    if (!ALLOWED_READ_ROLES.includes(req.user?.role_name)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to export membership plans",
      });
    }

    const search = req.query.search || "";
    const branchId = req.query.branchId;
    const gymId = req.query.gymId;

    let baseQuery = `FROM membership_plans p LEFT JOIN branches b ON p.branch_id = b.id LEFT JOIN gyms g ON g.id = b.gym_id`;
    let dataParams = [];
    let conditions = [];

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      conditions.push(`b.gym_id = $${dataParams.length + 1}`);
      dataParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to export membership plans",
      });
    }

    // Shared branch-access helper (Day 2 Prompt 2)
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      conditions.push(`p.branch_id = $${dataParams.length + 1}`);
      dataParams.push(branchAccess.branchId);
    }

    if (branchId && branchAccess.type !== "BRANCH") {
      conditions.push(`p.branch_id = $${dataParams.length + 1}`);
      dataParams.push(branchId);
    } else if (gymId && req.tenant?.isSystemAdmin) {
      conditions.push(`b.gym_id = $${dataParams.length + 1}`);
      dataParams.push(gymId);
    }

    if (search) {
      conditions.push(`p.name ILIKE $${dataParams.length + 1}`);
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
