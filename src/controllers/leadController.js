const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");
const { sanitizePhone, isValidPhone } = require("../utils/phoneValidation");

// ======================================================
// CREATE LEAD
// ======================================================
const createLead = async (req, res, next) => {
  try {
    const { branch_id, full_name, email, phone, status, source, notes, interest_in } = req.body;

    if (!full_name || !full_name.trim() || !phone) {
      return res.status(400).json({
        success: false,
        message: "Full name and phone are required",
      });
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

    let targetBranchId = branch_id;
    if (!targetBranchId && req.tenant?.branchId) {
      targetBranchId = req.tenant.branchId;
    }

    let leadGymId = req.tenant?.gymId;

    if (targetBranchId) {
      const branchRes = await pool.query(`SELECT id, gym_id FROM branches WHERE id = $1 LIMIT 1`, [targetBranchId]);
      if (branchRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Branch not found" });
      }

      if (req.tenant?.gymId && branchRes.rows[0].gym_id !== req.tenant.gymId) {
        return res.status(403).json({ success: false, message: "You do not have access to this branch" });
      }

      if (req.tenant?.branchId && req.tenant.branchId !== targetBranchId) {
        return res.status(403).json({ success: false, message: "You do not have access to this branch" });
      }

      leadGymId = branchRes.rows[0].gym_id;
    }

    // Reject duplicate phone numbers inside the same gym
    if (leadGymId) {
      const dupLead = await pool.query(
        `
        SELECT l.id
        FROM leads l
        JOIN branches b ON b.id = l.branch_id
        WHERE b.gym_id = $1 AND l.phone = $2
        LIMIT 1
        `,
        [leadGymId, cleanPhone]
      );

      if (dupLead.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "A lead with this phone number already exists in this gym",
        });
      }
    }

    const query = `
      INSERT INTO leads (branch_id, full_name, email, phone, status, source, notes, interest_in)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const values = [targetBranchId || null, full_name.trim(), email?.trim().toLowerCase() || null, cleanPhone, status || 'New', source || null, notes || null, interest_in || null];
    
    const result = await pool.query(query, values);
    
    return res.status(201).json({
      success: true,
      data: { lead: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET LEADS
// ======================================================
const getLeads = async (req, res, next) => {
  try {
    const { gymId, branchId, search, status } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    let baseQuery = `
      FROM leads l
      LEFT JOIN branches b ON l.branch_id = b.id
      LEFT JOIN gyms g ON b.gym_id = g.id
    `;
    let conditions = [];
    let countParams = [];
    let queryParams = [];

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(req.tenant.gymId);
      queryParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view leads",
      });
    }

    // Shared branch-access helper (Day 2 Prompt 2)
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      conditions.push(`l.branch_id = $${countParams.length + 1}`);
      countParams.push(branchAccess.branchId);
      queryParams.push(branchAccess.branchId);
    }

    // Query filters
    if (branchId && branchAccess.type !== "BRANCH") {
      conditions.push(`l.branch_id = $${countParams.length + 1}`);
      countParams.push(branchId);
      queryParams.push(branchId);
    } else if (gymId && req.tenant?.isSystemAdmin) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(gymId);
      queryParams.push(gymId);
    }

    if (status) {
      conditions.push(`l.status = $${countParams.length + 1}`);
      countParams.push(status);
      queryParams.push(status);
    }

    if (search) {
      const searchStr = `%${search}%`;
      conditions.push(`(l.full_name ILIKE $${countParams.length + 1} OR l.email ILIKE $${countParams.length + 1} OR l.phone ILIKE $${countParams.length + 1})`);
      countParams.push(searchStr);
      queryParams.push(searchStr);
    }

    if (conditions.length > 0) {
      baseQuery += ` WHERE ` + conditions.join(" AND ");
    }

    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const dataQuery = `
      SELECT l.*, g.name as gym_name, b.name as branch_name 
      ${baseQuery}
      ORDER BY l.created_at DESC
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

    queryParams.push(limit, offset);

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count, 10);
    const result = await pool.query(dataQuery, queryParams);

    return res.status(200).json({
      success: true,
      data: {
        leads: result.rows,
        pagination: {
          totalItems: total,
          total,
          page,
          currentPage: page,
          limit,
          totalPages: Math.ceil(total / limit) || 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE LEAD
// ======================================================
const updateLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { branch_id, full_name, email, phone, status, source, notes, interest_in } = req.body;

    const checkResult = await pool.query(
      `SELECT l.id, b.gym_id, l.branch_id 
       FROM leads l 
       LEFT JOIN branches b ON l.branch_id = b.id 
       WHERE l.id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const lead = checkResult.rows[0];

    // Tenant Gym Isolation
    if (req.tenant?.gymId && lead.gym_id && lead.gym_id !== req.tenant.gymId) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.tenant?.branchId && lead.branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this lead" });
    }

    if (full_name !== undefined && (!full_name || !full_name.trim())) {
      return res.status(400).json({ success: false, message: "Full name is required" });
    }

    let targetGymId = lead.gym_id || req.tenant?.gymId;

    if (branch_id) {
      const branchRes = await pool.query(`SELECT id, gym_id FROM branches WHERE id = $1 LIMIT 1`, [branch_id]);
      if (branchRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Branch not found" });
      }
      if (req.tenant?.gymId && branchRes.rows[0].gym_id !== req.tenant.gymId) {
        return res.status(403).json({ success: false, message: "Branch does not belong to your gym" });
      }
      targetGymId = branchRes.rows[0].gym_id;
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

      if (targetGymId) {
        const dupLead = await pool.query(
          `
          SELECT l.id
          FROM leads l
          JOIN branches b ON b.id = l.branch_id
          WHERE b.gym_id = $1 AND l.phone = $2 AND l.id != $3
          LIMIT 1
          `,
          [targetGymId, cleanPhone, id]
        );

        if (dupLead.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message: "A lead with this phone number already exists in this gym",
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

    const query = `
      UPDATE leads
      SET branch_id = COALESCE($1::uuid, branch_id),
          full_name = COALESCE($2, full_name),
          email = COALESCE($3, email),
          phone = COALESCE($4, phone),
          status = COALESCE($5, status),
          source = COALESCE($6, source),
          notes = COALESCE($7, notes),
          interest_in = COALESCE($8, interest_in),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *;
    `;
    const values = [
      branch_id || null,
      full_name ? full_name.trim() : null,
      email ? email.trim().toLowerCase() : null,
      cleanPhone !== undefined ? cleanPhone : null,
      status || null,
      source || null,
      notes || null,
      interest_in || null,
      id
    ];
    const result = await pool.query(query, values);

    return res.status(200).json({ success: true, data: { lead: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE LEAD
// ======================================================
const deleteLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const checkResult = await pool.query(
      `SELECT l.id, b.gym_id, l.branch_id 
       FROM leads l 
       LEFT JOIN branches b ON l.branch_id = b.id 
       WHERE l.id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const lead = checkResult.rows[0];

    // Tenant Gym Isolation
    if (req.tenant?.gymId && lead.gym_id && lead.gym_id !== req.tenant.gymId) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.tenant?.branchId && lead.branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this lead" });
    }

    await pool.query("DELETE FROM leads WHERE id = $1", [id]);

    return res.status(200).json({ success: true, message: "Lead deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createLead,
  getLeads,
  updateLead,
  deleteLead
};
