const pool = require("../config/db");

// ======================================================
// CREATE BILLING PLAN
// ======================================================
const createBillingPlan = async (req, res, next) => {
  try {
    const { name, price_monthly, price_yearly, max_branches, max_members, features, is_active } = req.body;
    
    if (!name || price_monthly === undefined) {
      return res.status(400).json({ success: false, message: "Name and monthly price are required" });
    }

    const result = await pool.query(
      `INSERT INTO billing_plans (name, price_monthly, price_yearly, max_branches, max_members, features, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true))
       RETURNING *`,
      [name, price_monthly, price_yearly || 0, max_branches || -1, max_members || -1, features ? JSON.stringify(features) : '{}', is_active]
    );

    return res.status(201).json({ success: true, message: "Billing plan created", data: { billingPlan: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ALL BILLING PLANS (Paginated & Searchable)
// ======================================================
const getBillingPlans = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    
    let baseQuery = `FROM billing_plans`;
    let conditions = [];
    let queryParams = [];

    if (search) {
      conditions.push(`name ILIKE $${queryParams.length + 1}`);
      queryParams.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      baseQuery += ` WHERE ` + conditions.join(" AND ");
    }

    let countQuery = `SELECT COUNT(*) ${baseQuery}`;
    let dataQuery = `SELECT * ${baseQuery} ORDER BY created_at DESC, id ASC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    
    const countResult = await pool.query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].count, 10);
    
    queryParams.push(limit, offset);
    const result = await pool.query(dataQuery, queryParams);

    return res.status(200).json({
      success: true,
      data: {
        billingPlans: result.rows,
        pagination: { totalItems: total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET BILLING PLAN BY ID
// ======================================================
const getBillingPlanById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`SELECT * FROM billing_plans WHERE id = $1`, [id]);
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: { billingPlan: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE BILLING PLAN
// ======================================================
const updateBillingPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, price_monthly, price_yearly, max_branches, max_members, features, is_active } = req.body;

    const result = await pool.query(
      `UPDATE billing_plans 
       SET name = COALESCE($1, name), price_monthly = COALESCE($2, price_monthly), 
           price_yearly = COALESCE($3, price_yearly), max_branches = COALESCE($4, max_branches),
           max_members = COALESCE($5, max_members), features = COALESCE($6, features), 
           is_active = COALESCE($7, is_active)
       WHERE id = $8 RETURNING *`,
      [name, price_monthly, price_yearly, max_branches, max_members, features ? JSON.stringify(features) : null, is_active, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, message: "Updated successfully", data: { billingPlan: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE BILLING PLAN
// ======================================================
const deleteBillingPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`UPDATE billing_plans SET is_active = false WHERE id = $1 RETURNING id`, [id]);
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, message: "Deactivated successfully" });
  } catch (error) {
    next(error);
  }
};

const hardDeleteBillingPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM billing_plans WHERE id = $1 RETURNING id`, [id]);
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, message: "Deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createBillingPlan, getBillingPlans, getBillingPlanById, updateBillingPlan, deleteBillingPlan, hardDeleteBillingPlan
};
