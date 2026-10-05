const pool = require("../config/db");

// ======================================================
// CREATE GYM
// ======================================================

const createGym = async (req, res, next) => {
  try {
    const {
      name,
      logoUrl,
      email,
      phone,
      city,
      state,
      country,
    } = req.body;

    // --------------------------------------------------
    // 1. Validate
    // --------------------------------------------------

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Gym name is required",
      });
    }

    // --------------------------------------------------
    // 2. Only super-admin
    // --------------------------------------------------

    if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "Only super-admin can create gyms",
      });
    }

    // --------------------------------------------------
    // 3. Create gym
    // --------------------------------------------------

    const result = await pool.query(
      `
      INSERT INTO gyms (
        owner_id,
        name,
        logo_url,
        email,
        phone,
        city,
        state,
        country
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8
      )
      RETURNING
        id,
        owner_id,
        name,
        logo_url,
        email,
        phone,
        city,
        state,
        country,
        billing_plan_id,
        is_active,
        created_at,
        updated_at
      `,
      [
        req.user.id,
        name.trim(),
        logoUrl || null,
        email ? email.trim().toLowerCase() : null,
        phone || null,
        city || null,
        state || null,
        country || null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Gym created successfully",
      data: {
        gym: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ALL GYMS
// ======================================================

const getGyms = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    const sort_by = req.query.sort_by || "created_at";
    const sort_dir = req.query.sort_dir === "asc" ? "ASC" : "DESC";

    // Validate sort field
    const allowedSortFields = ["name", "email", "phone", "city", "is_active", "created_at"];
    const sortField = allowedSortFields.includes(sort_by) ? sort_by : "created_at";

    const gymId = req.query.gymId;

    let baseQuery = `FROM gyms`;
    let conditions = [];
    let countParams = [];
    let queryParams = [];

    if (gymId) {
      conditions.push(`id = $${countParams.length + 1}`);
      countParams.push(gymId);
      queryParams.push(gymId);
    }

    if (search) {
      const searchCondition = `(name ILIKE $${countParams.length + 1} OR email ILIKE $${countParams.length + 1} OR phone ILIKE $${countParams.length + 1} OR city ILIKE $${countParams.length + 1})`;
      conditions.push(searchCondition);
      countParams.push(`%${search}%`);
      queryParams.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      baseQuery += ` WHERE ` + conditions.join(" AND ");
    }

    let countQuery = `SELECT COUNT(*) ${baseQuery}`;
    
    let dataQuery = `
      SELECT
        id,
        owner_id,
        name,
        logo_url,
        email,
        phone,
        city,
        state,
        country,
        billing_plan_id,
        is_active,
        created_at,
        updated_at
      ${baseQuery}
      ORDER BY ${sortField} ${sort_dir} 
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

    queryParams.push(limit, offset);

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await pool.query(dataQuery, queryParams);

    return res.status(200).json({
      success: true,
      data: {
        gyms: result.rows,
        pagination: {
          totalItems: total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET GYM BY ID
// ======================================================

const getGymById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT
        id,
        owner_id,
        name,
        logo_url,
        email,
        phone,
        city,
        state,
        country,
        billing_plan_id,
        is_active,
        created_at,
        updated_at
      FROM gyms
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Gym not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        gym: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE GYM
// ======================================================

const updateGym = async (req, res, next) => {
  try {
    const { id } = req.params;

    const {
      name,
      logoUrl,
      email,
      phone,
      city,
      state,
      country,
      billingPlanId,
      isActive,
    } = req.body;

    // --------------------------------------------------
    // Check gym
    // --------------------------------------------------

    const gymResult = await pool.query(
      `
      SELECT id
      FROM gyms
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (gymResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Gym not found",
      });
    }

    // --------------------------------------------------
    // Update
    // --------------------------------------------------

    const result = await pool.query(
      `
      UPDATE gyms
      SET
        name = COALESCE($1, name),
        logo_url = COALESCE($2, logo_url),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        city = COALESCE($5, city),
        state = COALESCE($6, state),
        country = COALESCE($7, country),
        billing_plan_id = COALESCE($8::uuid, billing_plan_id),
        is_active = COALESCE($9, is_active),
        updated_at = NOW()
      WHERE id = $10
      RETURNING
        id,
        owner_id,
        name,
        logo_url,
        email,
        phone,
        city,
        state,
        country,
        billing_plan_id,
        is_active,
        created_at,
        updated_at
      `,
      [
        name ? name.trim() : null,
        logoUrl,
        email ? email.trim().toLowerCase() : null,
        phone,
        city,
        state,
        country,
        billingPlanId,
        isActive,
        id,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Gym updated successfully",
      data: {
        gym: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE GYM
// ======================================================

const deleteGym = async (req, res, next) => {
  try {
    const { id } = req.params;

    // --------------------------------------------------
    // We use soft delete
    // --------------------------------------------------

    const result = await pool.query(
      `
      UPDATE gyms
      SET
        is_active = false,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        name,
        is_active
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Gym not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Gym deactivated successfully",
      data: {
        gym: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// HARD DELETE GYM
// ======================================================

const hardDeleteGym = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM gyms
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Gym not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Gym deleted permanently",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ALL BILLING PLANS
// ======================================================

const getBillingPlans = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, price_monthly, max_branches, max_members FROM billing_plans ORDER BY created_at ASC`
    );
    return res.status(200).json({
      success: true,
      data: {
        billingPlans: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createGym,
  getGyms,
  getGymById,
  updateGym,
  deleteGym,
  hardDeleteGym,
  getBillingPlans,
};