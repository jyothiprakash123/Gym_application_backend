const pool = require("../config/db");

// ======================================================
// CREATE LEAD
// ======================================================
const createLead = async (req, res, next) => {
  try {
    const { branch_id, full_name, email, phone, status, source, notes, interest_in } = req.body;

    // Permissions logic
    if (["trainer", "front-desk", "accountant"].includes(req.user.role_name)) {
      if (req.user.branch_id !== branch_id) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }

    const query = `
      INSERT INTO leads (branch_id, full_name, email, phone, status, source, notes, interest_in)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const values = [branch_id || null, full_name, email, phone, status || 'New', source, notes, interest_in];
    
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

    // Apply role-based filtering
    if (req.user.role_name === "admin") {
      conditions.push(`g.id = $${countParams.length + 1}`);
      countParams.push(req.user.gym_id);
      queryParams.push(req.user.gym_id);
    } else if (["trainer", "front-desk", "accountant"].includes(req.user.role_name)) {
      conditions.push(`g.id = $${countParams.length + 1}`);
      countParams.push(req.user.gym_id);
      queryParams.push(req.user.gym_id);

      conditions.push(`l.branch_id = $${countParams.length + 1}`);
      countParams.push(req.user.branch_id);
      queryParams.push(req.user.branch_id);
    }

    // Apply explicit query filters
    if (gymId) {
      conditions.push(`g.id = $${countParams.length + 1}`);
      countParams.push(gymId);
      queryParams.push(gymId);
    }
    if (branchId) {
      conditions.push(`l.branch_id = $${countParams.length + 1}`);
      countParams.push(branchId);
      queryParams.push(branchId);
    }
    if (status) {
      conditions.push(`l.status = $${countParams.length + 1}`);
      countParams.push(status);
      queryParams.push(status);
    }
    if (search) {
      conditions.push(`(l.full_name ILIKE $${countParams.length + 1} OR l.email ILIKE $${countParams.length + 1} OR l.phone ILIKE $${countParams.length + 1})`);
      countParams.push(`%${search}%`);
      queryParams.push(`%${search}%`);
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
          page,
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
    const { name, email, phone, status, source, notes } = req.body;

    const checkResult = await pool.query("SELECT l.*, b.gym_id FROM leads l LEFT JOIN branches b ON l.branch_id = b.id WHERE l.id = $1", [id]);
    if (checkResult.rows.length === 0) return res.status(404).json({ success: false, message: "Lead not found" });
    const lead = checkResult.rows[0];

    // Auth logic
    if (req.user.role_name === "admin" && req.user.gym_id !== lead.gym_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const query = `
      UPDATE leads
      SET full_name = COALESCE($1, full_name),
          email = COALESCE($2, email),
          phone = COALESCE($3, phone),
          status = COALESCE($4, status),
          source = COALESCE($5, source),
          notes = COALESCE($6, notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *;
    `;
    const values = [req.body.full_name, req.body.email, req.body.phone, req.body.status, req.body.source, req.body.notes, id];
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
    
    const checkResult = await pool.query("SELECT l.*, b.gym_id FROM leads l LEFT JOIN branches b ON l.branch_id = b.id WHERE l.id = $1", [id]);
    if (checkResult.rows.length === 0) return res.status(404).json({ success: false, message: "Lead not found" });
    const lead = checkResult.rows[0];

    // Auth logic
    if (req.user.role_name === "admin" && req.user.gym_id !== lead.gym_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
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
