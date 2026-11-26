const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { appendCreatedAtDateFilter } = require("../utils/dateUtils");

/**
 * Generates a clean, secure temporary password meeting enterprise password policies:
 * Minimum 10 characters, upper, lower, number, and special character.
 */
const generateSecurePassword = () => {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";

  const getRandomChar = (charset) => charset[crypto.randomInt(0, charset.length)];

  const requiredChars = [
    getRandomChar(upper),
    getRandomChar(lower),
    getRandomChar(digits),
    getRandomChar(symbols),
  ];

  const allChars = upper + lower + digits + symbols;
  const remainingCount = 8; // Total 12 chars
  for (let i = 0; i < remainingCount; i++) {
    requiredChars.push(getRandomChar(allChars));
  }

  // Shuffle array
  return requiredChars.sort(() => Math.random() - 0.5).join("");
};

// ======================================================
// 1. CREATE ACCESS REQUEST (Public / Landing Page)
// ======================================================
const createAccessRequest = async (req, res, next) => {
  try {
    const {
      gymName,
      gym_name,
      fullName,
      full_name,
      email,
      phone,
      planName,
      plan_name,
      planId,
      plan_id,
      billingCycle,
      billing_cycle,
      price,
      planDetails,
      plan_details,
      notes,
    } = req.body;

    const resolvedGymName = (gymName || gym_name || "").trim();
    const resolvedFullName = (fullName || full_name || "").trim();
    const resolvedEmail = (email || "").trim().toLowerCase();
    const resolvedPhone = (phone || "").trim();
    const resolvedPlanName = (planName || plan_name || "Starter").trim();
    const resolvedPlanId = (planId || plan_id || resolvedPlanName.toLowerCase()).trim();
    const resolvedBillingCycle = (billingCycle || billing_cycle || "yearly").toLowerCase();
    const resolvedPrice = price !== undefined && price !== null ? Number(price) : null;
    const resolvedPlanDetails = planDetails || plan_details || {};
    const resolvedNotes = (notes || "").trim();

    // Validation
    if (!resolvedGymName) {
      return res.status(400).json({
        success: false,
        message: "Gym name is required.",
      });
    }

    if (!resolvedEmail) {
      return res.status(400).json({
        success: false,
        message: "Email address is required.",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(resolvedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    if (!resolvedPhone) {
      return res.status(400).json({
        success: false,
        message: "Mobile phone number is required.",
      });
    }

    const cleanPhone = resolvedPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be between 10 and 15 digits.",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO plan_access_requests (
        gym_name,
        full_name,
        email,
        phone,
        plan_name,
        plan_id,
        billing_cycle,
        price,
        plan_details,
        notes,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      RETURNING *
      `,
      [
        resolvedGymName,
        resolvedFullName || null,
        resolvedEmail,
        resolvedPhone,
        resolvedPlanName,
        resolvedPlanId,
        resolvedBillingCycle,
        resolvedPrice,
        JSON.stringify(resolvedPlanDetails),
        resolvedNotes || null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Your request for access has been submitted successfully! Our team will review and set up your gym account shortly.",
      data: {
        request: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// 2. GET ALL ACCESS REQUESTS (System Admin Only)
// ======================================================
const getAccessRequests = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const search = (req.query.search || "").trim();
    const status = (req.query.status || "all").toLowerCase();

    let conditions = [];
    let queryParams = [];

    if (status && status !== "all") {
      conditions.push(`r.status = $${queryParams.length + 1}`);
      queryParams.push(status);
    }

    if (search) {
      conditions.push(
        `(r.gym_name ILIKE $${queryParams.length + 1} OR r.email ILIKE $${queryParams.length + 1} OR r.phone ILIKE $${queryParams.length + 1} OR r.full_name ILIKE $${queryParams.length + 1} OR r.plan_name ILIKE $${queryParams.length + 1})`
      );
      queryParams.push(`%${search}%`);
    }

    appendCreatedAtDateFilter(conditions, [queryParams], "r.created_at", req.query);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Counts Query for Dashboard Badges
    const countsResult = await pool.query(`
      SELECT 
        COUNT(*) AS total_count,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_count,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) AS approved_count,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected_count
      FROM plan_access_requests
    `);

    // Total Count for Pagination
    const countQuery = `SELECT COUNT(*) FROM plan_access_requests r ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);

    // Data Query (JOINs must be placed BEFORE WHERE clause)
    const dataQueryParams = [...queryParams, limit, offset];
    const dataQuery = `
      SELECT 
        r.*,
        u.email AS created_user_email,
        u.full_name AS created_user_name,
        g.name AS created_gym_name
      FROM plan_access_requests r
      LEFT JOIN users u ON r.created_user_id = u.id
      LEFT JOIN gyms g ON r.created_gym_id = g.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

    const dataResult = await pool.query(dataQuery, dataQueryParams);

    const countsRow = countsResult.rows[0] || {};

    return res.status(200).json({
      success: true,
      data: {
        requests: dataResult.rows,
        summary: {
          total: parseInt(countsRow.total_count, 10) || 0,
          pending: parseInt(countsRow.pending_count, 10) || 0,
          approved: parseInt(countsRow.approved_count, 10) || 0,
          rejected: parseInt(countsRow.rejected_count, 10) || 0,
        },
        pagination: {
          totalItems,
          total: totalItems,
          page,
          currentPage: page,
          limit,
          totalPages: Math.ceil(totalItems / limit) || 1,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// 3. GET ACCESS REQUEST BY ID (System Admin Only)
// ======================================================
const getAccessRequestById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        r.*,
        u.email AS created_user_email,
        u.full_name AS created_user_name,
        g.name AS created_gym_name
      FROM plan_access_requests r
      LEFT JOIN users u ON r.created_user_id = u.id
      LEFT JOIN gyms g ON r.created_gym_id = g.id
      WHERE r.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Access request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        request: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// 4. CONVERT ACCESS REQUEST (Create Gym + Branch + Super Admin User)
// ======================================================
const convertAccessRequest = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    // Fetch the request record
    const reqRes = await client.query(
      `SELECT * FROM plan_access_requests WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (reqRes.rows.length === 0) {
      client.release();
      return res.status(404).json({
        success: false,
        message: "Access request not found.",
      });
    }

    const request = reqRes.rows[0];

    if (request.status === "approved" && request.created_user_id) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "This request has already been approved and provisioned with an account.",
      });
    }

    const {
      gymName,
      fullName,
      email,
      phone,
      password,
      billingPlanId,
      branchName,
      city,
      state,
      country,
      adminNotes,
    } = req.body;

    const resolvedGymName = (gymName || request.gym_name || "").trim();
    const resolvedFullName = (fullName || request.full_name || `${resolvedGymName} Owner`).trim();
    const resolvedEmail = (email || request.email || "").trim().toLowerCase();
    const resolvedPhone = (phone || request.phone || "").trim();
    const plainPassword = (password || "").trim() || generateSecurePassword();
    const resolvedBranchName = (branchName || "Main Branch").trim();
    const resolvedCity = (city || "").trim() || null;
    const resolvedState = (state || "").trim() || null;
    const resolvedCountry = (country || "India").trim();

    // Check if email already registered in users table
    const existingUserRes = await client.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [resolvedEmail]
    );

    if (existingUserRes.rows.length > 0) {
      client.release();
      return res.status(400).json({
        success: false,
        message: `A user with email "${resolvedEmail}" is already registered in the system.`,
      });
    }

    // Resolve Billing Plan ID
    let finalBillingPlanId = billingPlanId || null;
    if (!finalBillingPlanId) {
      const planMatch = await client.query(
        `SELECT id FROM billing_plans WHERE LOWER(name) = LOWER($1) AND is_active = true LIMIT 1`,
        [request.plan_name]
      );
      if (planMatch.rows.length > 0) {
        finalBillingPlanId = planMatch.rows[0].id;
      } else {
        const fallbackPlan = await client.query(
          `SELECT id FROM billing_plans WHERE is_active = true ORDER BY price_monthly ASC LIMIT 1`
        );
        if (fallbackPlan.rows.length > 0) {
          finalBillingPlanId = fallbackPlan.rows[0].id;
        }
      }
    }

    // Resolve 'super-admin' Role
    const superAdminRoleRes = await client.query(
      `SELECT id, name FROM roles WHERE name = 'super-admin' LIMIT 1`
    );

    if (superAdminRoleRes.rows.length === 0) {
      client.release();
      return res.status(500).json({
        success: false,
        message: "System role 'super-admin' was not found in the database.",
      });
    }

    const superAdminRoleId = superAdminRoleRes.rows[0].id;

    // Begin DB Transaction
    await client.query("BEGIN");

    // 1. Create the Gym
    const gymResult = await client.query(
      `
      INSERT INTO gyms (
        name,
        email,
        phone,
        city,
        state,
        country,
        billing_plan_id,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      RETURNING id, name, email, phone, billing_plan_id, is_active, created_at
      `,
      [
        resolvedGymName,
        resolvedEmail,
        resolvedPhone || null,
        resolvedCity,
        resolvedState,
        resolvedCountry,
        finalBillingPlanId,
      ]
    );
    const newGym = gymResult.rows[0];

    // 2. Create the default Branch
    const branchResult = await client.query(
      `
      INSERT INTO branches (
        gym_id,
        name,
        phone,
        email,
        city,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING id, name, gym_id, is_active
      `,
      [
        newGym.id,
        resolvedBranchName,
        resolvedPhone || null,
        resolvedEmail,
        resolvedCity,
      ]
    );
    const newBranch = branchResult.rows[0];

    // 3. Hash Password & Create the Super Admin User
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(plainPassword, salt);

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
        resolvedEmail,
        hashedPassword,
        resolvedFullName,
        resolvedPhone || null,
        superAdminRoleId,
        newGym.id,
        newBranch.id,
      ]
    );
    const newUser = userResult.rows[0];

    // 4. Associate Gym Owner and Branch Manager
    await client.query(
      `UPDATE gyms SET owner_id = $1 WHERE id = $2`,
      [newUser.id, newGym.id]
    );

    await client.query(
      `UPDATE branches SET manager_id = $1 WHERE id = $2`,
      [newUser.id, newBranch.id]
    );

    // 5. Update Access Request Record
    await client.query(
      `
      UPDATE plan_access_requests 
      SET 
        status = 'approved',
        created_user_id = $1,
        created_gym_id = $2,
        admin_notes = COALESCE($3, admin_notes),
        updated_at = NOW()
      WHERE id = $4
      `,
      [newUser.id, newGym.id, adminNotes || "Approved and provisioned by System Administrator", id]
    );

    await client.query("COMMIT");
    client.release();

    return res.status(201).json({
      success: true,
      message: `Successfully created Gym "${newGym.name}" and User account for "${newUser.full_name}"!`,
      data: {
        gym: newGym,
        branch: newBranch,
        user: {
          id: newUser.id,
          email: newUser.email,
          fullName: newUser.full_name,
          phone: newUser.phone,
          roleName: "super-admin",
        },
        credentials: {
          email: newUser.email,
          temporaryPassword: plainPassword,
          gymName: newGym.name,
          branchName: newBranch.name,
          role: "Super Admin (Business Owner)",
        },
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    client.release();
    next(error);
  }
};

// ======================================================
// 5. UPDATE STATUS / ADMIN NOTES (System Admin Only)
// ======================================================
const updateAccessRequestStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const allowedStatuses = ["pending", "approved", "rejected"];
    if (status && !allowedStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${allowedStatuses.join(", ")}`,
      });
    }

    const result = await pool.query(
      `
      UPDATE plan_access_requests
      SET
        status = COALESCE($1, status),
        admin_notes = COALESCE($2, admin_notes),
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
      `,
      [status ? status.toLowerCase() : null, adminNotes || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Access request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Access request updated successfully.",
      data: {
        request: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// 6. DELETE ACCESS REQUEST (System Admin Only)
// ======================================================
const deleteAccessRequest = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM plan_access_requests WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Access request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Access request deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createAccessRequest,
  getAccessRequests,
  getAccessRequestById,
  convertAccessRequest,
  updateAccessRequestStatus,
  deleteAccessRequest,
};
