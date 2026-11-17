const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");
const { sanitizePhone, isValidPhone } = require("../utils/phoneValidation");
const notificationService = require("../services/notificationService");

const LEAD_STATUSES = ["New", "Contacted", "Follow-up", "Trial", "Converted", "Lost"];

const VALID_TRANSITIONS = {
  "New": ["New", "Contacted", "Follow-up", "Trial", "Converted", "Lost"],
  "Contacted": ["Contacted", "Follow-up", "Trial", "Converted", "Lost"],
  "Follow-up": ["Follow-up", "Contacted", "Trial", "Converted", "Lost"],
  "Trial": ["Trial", "Contacted", "Follow-up", "Converted", "Lost"],
  "Converted": ["Converted"], // terminal conversion
  "Lost": ["Lost", "New", "Contacted", "Follow-up", "Trial"], // can reopen
};

const normalizeLeadStatus = (status) => {
  if (!status) return null;
  const s = String(status).trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (s === "new") return "New";
  if (s === "contacted") return "Contacted";
  if (s === "follow-up" || s === "followup") return "Follow-up";
  if (s === "trial") return "Trial";
  if (s === "converted") return "Converted";
  if (s === "lost") return "Lost";
  return null;
};

const parseFollowUpDate = (val) => {
  if (val === undefined) return undefined;
  if (val === null || val === "") return null;
  const str = String(val).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const parsed = new Date(str);
    if (isNaN(parsed.getTime())) return false;
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const [y, m, d] = str.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  return str;
};

// ======================================================
// CREATE LEAD
// ======================================================
const createLead = async (req, res, next) => {
  try {
    const { branch_id, full_name, email, phone, status, source, notes, interest_in, follow_up_date } = req.body;

    if (!full_name || !full_name.trim() || !phone) {
      return res.status(400).json({
        success: false,
        message: "Full name and phone are required",
      });
    }

    let normalizedStatus = "New";
    if (status !== undefined && status !== null && String(status).trim() !== "") {
      normalizedStatus = normalizeLeadStatus(status);
      if (!normalizedStatus) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Allowed statuses are: New, Contacted, Follow-up, Trial, Converted, Lost",
        });
      }
    }

    let parsedFollowUpDate = null;
    if (follow_up_date !== undefined && follow_up_date !== null && String(follow_up_date).trim() !== "") {
      parsedFollowUpDate = parseFollowUpDate(follow_up_date);
      if (!parsedFollowUpDate) {
        return res.status(400).json({
          success: false,
          message: "Invalid follow-up date format. Expected YYYY-MM-DD",
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
      INSERT INTO leads (branch_id, full_name, email, phone, status, source, notes, interest_in, follow_up_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const values = [
      targetBranchId || null,
      full_name.trim(),
      email?.trim().toLowerCase() || null,
      cleanPhone,
      normalizedStatus,
      source || null,
      notes || null,
      interest_in || null,
      parsedFollowUpDate,
    ];
    
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
    const { gymId, branchId, search, status, sort_by, sort_dir } = req.query;
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

    if (status && String(status).trim() !== "" && String(status).trim().toLowerCase() !== "all") {
      const normStatus = normalizeLeadStatus(status);
      const filterVal = normStatus || status;
      conditions.push(`l.status ILIKE $${countParams.length + 1}`);
      countParams.push(filterVal);
      queryParams.push(filterVal);
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

    const ALLOWED_SORT_COLUMNS = {
      created_at: "l.created_at",
      full_name: "l.full_name",
      email: "l.email",
      status: "l.status",
      source: "l.source",
      follow_up_date: "l.follow_up_date",
    };
    const sortColumn = ALLOWED_SORT_COLUMNS[sort_by] || "l.created_at";
    const sortDirection = String(sort_dir).toUpperCase() === "ASC" ? "ASC" : "DESC";
    const orderClause = `ORDER BY ${sortColumn} ${sortDirection} NULLS LAST`;

    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const dataQuery = `
      SELECT l.*, g.name as gym_name, b.name as branch_name 
      ${baseQuery}
      ${orderClause}
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
    const { branch_id, full_name, email, phone, status, source, notes, interest_in, follow_up_date } = req.body;

    const checkResult = await pool.query(
      `SELECT l.id, l.status, l.follow_up_date, b.gym_id, l.branch_id 
       FROM leads l 
       LEFT JOIN branches b ON l.branch_id = b.id 
       WHERE l.id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const lead = checkResult.rows[0];

    // Status transition validation
    let targetStatus = undefined;
    if (status !== undefined && status !== null && String(status).trim() !== "") {
      targetStatus = normalizeLeadStatus(status);
      if (!targetStatus) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Allowed statuses are: New, Contacted, Follow-up, Trial, Converted, Lost",
        });
      }

      const currentStatus = normalizeLeadStatus(lead.status) || "New";

      if (targetStatus !== currentStatus) {
        const allowedNext = VALID_TRANSITIONS[currentStatus] || [currentStatus];
        if (!allowedNext.includes(targetStatus)) {
          return res.status(400).json({
            success: false,
            message: `Invalid status transition from '${currentStatus}' to '${targetStatus}'.`,
          });
        }
      }
    }

    // Follow-up date validation
    let targetFollowUpDate = undefined;
    if (follow_up_date !== undefined) {
      if (follow_up_date === null || String(follow_up_date).trim() === "") {
        targetFollowUpDate = null;
      } else {
        targetFollowUpDate = parseFollowUpDate(follow_up_date);
        if (!targetFollowUpDate) {
          return res.status(400).json({
            success: false,
            message: "Invalid follow-up date format. Expected YYYY-MM-DD",
          });
        }
      }
    }

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
          follow_up_date = CASE WHEN $9::boolean THEN $10::date ELSE follow_up_date END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *;
    `;
    const values = [
      branch_id || null,
      full_name ? full_name.trim() : null,
      email ? email.trim().toLowerCase() : null,
      cleanPhone !== undefined ? cleanPhone : null,
      targetStatus || null,
      source || null,
      notes || null,
      interest_in || null,
      follow_up_date !== undefined,
      targetFollowUpDate || null,
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

// ======================================================
// GET LEAD INTERACTIONS (TIMELINE NEWEST FIRST)
// ======================================================
const getLeadInteractions = async (req, res, next) => {
  try {
    const { id } = req.params;

    const leadCheck = await pool.query(
      `SELECT l.id, l.full_name, l.status, b.gym_id, l.branch_id 
       FROM leads l 
       LEFT JOIN branches b ON l.branch_id = b.id 
       WHERE l.id = $1`,
      [id]
    );

    if (leadCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const lead = leadCheck.rows[0];

    // Tenant Gym Isolation
    if (req.tenant?.gymId && lead.gym_id && lead.gym_id !== req.tenant.gymId) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.tenant?.branchId && lead.branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this lead" });
    }

    const interactionsQuery = `
      SELECT 
        i.id,
        i.lead_id,
        i.interaction_type,
        i.notes,
        i.done_by,
        i.interaction_date,
        u.full_name AS done_by_name,
        u.email AS done_by_email,
        r.name AS done_by_role
      FROM lead_interactions i
      LEFT JOIN users u ON i.done_by = u.id
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE i.lead_id = $1
      ORDER BY i.interaction_date DESC, i.id DESC
    `;

    const result = await pool.query(interactionsQuery, [id]);

    return res.status(200).json({
      success: true,
      data: {
        lead: {
          id: lead.id,
          full_name: lead.full_name,
          status: lead.status,
        },
        interactions: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// ADD LEAD INTERACTION (NOTE)
// ======================================================
const addLeadInteraction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes, interaction_type, interaction_date } = req.body;

    if (!notes || !notes.trim()) {
      return res.status(400).json({
        success: false,
        message: "Note content is required",
      });
    }

    const leadCheck = await pool.query(
      `SELECT l.id, b.gym_id, l.branch_id 
       FROM leads l 
       LEFT JOIN branches b ON l.branch_id = b.id 
       WHERE l.id = $1`,
      [id]
    );

    if (leadCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const lead = leadCheck.rows[0];

    // Tenant Gym Isolation
    if (req.tenant?.gymId && lead.gym_id && lead.gym_id !== req.tenant.gymId) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.tenant?.branchId && lead.branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this lead" });
    }

    const validTypes = ["note", "call", "whatsapp", "email", "meeting", "other"];
    let type = (interaction_type || "note").trim().toLowerCase();
    if (!validTypes.includes(type)) {
      type = "note";
    }

    let parsedDate = null;
    if (interaction_date) {
      const d = new Date(interaction_date);
      if (!isNaN(d.getTime())) {
        parsedDate = d;
      }
    }

    const doneByUserId = req.user?.id;

    const insertQuery = `
      INSERT INTO lead_interactions (lead_id, interaction_type, notes, done_by, interaction_date)
      VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_TIMESTAMP))
      RETURNING *;
    `;

    const result = await pool.query(insertQuery, [
      id,
      type,
      notes.trim(),
      doneByUserId || null,
      parsedDate,
    ]);

    await pool.query(
      "UPDATE leads SET updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [id]
    );

    let author = {};
    if (doneByUserId) {
      const authorRes = await pool.query(
        `SELECT u.full_name, u.email, r.name AS role_name
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1`,
        [doneByUserId]
      );
      author = authorRes.rows[0] || {};
    }

    const fullInteraction = {
      ...result.rows[0],
      done_by_name: author.full_name || req.user?.full_name || "Staff",
      done_by_email: author.email || req.user?.email || "",
      done_by_role: author.role_name || req.user?.role_name || "",
    };

    return res.status(201).json({
      success: true,
      data: {
        interaction: fullInteraction,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE LEAD INTERACTION
// ======================================================
const deleteLeadInteraction = async (req, res, next) => {
  try {
    const { id, interactionId } = req.params;

    const leadCheck = await pool.query(
      `SELECT l.id, b.gym_id, l.branch_id 
       FROM leads l 
       LEFT JOIN branches b ON l.branch_id = b.id 
       WHERE l.id = $1`,
      [id]
    );

    if (leadCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const lead = leadCheck.rows[0];

    if (req.tenant?.gymId && lead.gym_id && lead.gym_id !== req.tenant.gymId) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (req.tenant?.branchId && lead.branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this lead" });
    }

    const delRes = await pool.query(
      "DELETE FROM lead_interactions WHERE id = $1 AND lead_id = $2 RETURNING id",
      [interactionId, id]
    );

    if (delRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Interaction note not found" });
    }

    return res.status(200).json({ success: true, message: "Interaction note deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// CONVERT LEAD TO MEMBER
// ======================================================
const convertLeadToMember = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    // Check if lead exists and tenant isolation
    const leadCheck = await pool.query(
      `SELECT l.id, l.full_name, l.email, l.phone, l.status, l.notes,
              l.branch_id, l.converted_member_id, b.gym_id, b.is_active as branch_is_active
       FROM leads l
       LEFT JOIN branches b ON l.branch_id = b.id
       WHERE l.id = $1`,
      [id]
    );

    if (leadCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const lead = leadCheck.rows[0];

    // Tenant gym isolation
    if (req.tenant?.gymId && lead.gym_id && lead.gym_id !== req.tenant.gymId) {
      client.release();
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    // Branch access isolation
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId && lead.branch_id && lead.branch_id !== branchAccess.branchId) {
      client.release();
      return res.status(403).json({ success: false, message: "You do not have access to this lead" });
    }

    // Prevent converting twice
    if (lead.status === "Converted" || lead.converted_member_id) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Lead has already been converted to a member",
      });
    }

    // Extract member fields, defaulting to lead data where appropriate
    const fullName = (req.body.fullName ?? req.body.full_name ?? lead.full_name ?? "").trim();
    const rawPhone = req.body.phone ?? lead.phone ?? "";
    const email = req.body.email !== undefined ? req.body.email : (lead.email ?? null);
    const branchId = req.body.branchId ?? req.body.branch_id ?? lead.branch_id;
    const dateOfBirth = req.body.dateOfBirth ?? req.body.date_of_birth ?? null;
    const gender = req.body.gender ?? null;
    const address = req.body.address ?? null;
    const profilePhotoUrl = req.body.profilePhotoUrl ?? null;
    const emergencyContactName = req.body.emergencyContactName ?? req.body.emergency_contact_name ?? null;
    const emergencyContactPhone = req.body.emergencyContactPhone ?? req.body.emergency_contact_phone ?? null;
    const healthNotes = req.body.healthNotes ?? req.body.health_notes ?? lead.notes ?? null;
    const joinDate = req.body.joinDate ?? req.body.join_date ?? new Date().toISOString().split("T")[0];
    const referredBy = req.body.referredBy ?? req.body.referred_by ?? null;

    if (!branchId || !fullName || !rawPhone) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Branch, full name and phone are required",
      });
    }

    if (dateOfBirth) {
      const dob = new Date(dateOfBirth);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (isNaN(dob.getTime()) || dob > today) {
        client.release();
        return res.status(400).json({
          success: false,
          message: "Date of birth cannot be in the future",
        });
      }
    }

    const cleanPhone = sanitizePhone(rawPhone);
    if (!cleanPhone || cleanPhone.length !== 10) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Phone number must be exactly 10 digits",
      });
    }
    if (!isValidPhone(cleanPhone)) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Phone number must be a valid 10-digit mobile number starting with 6, 7, 8, or 9",
      });
    }

    if (email && String(email).trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(String(email).trim())) {
        client.release();
        return res.status(400).json({
          success: false,
          message: "Please enter a valid email address",
        });
      }
    }

    let cleanEmerPhone = null;
    if (emergencyContactPhone && String(emergencyContactPhone).trim()) {
      cleanEmerPhone = sanitizePhone(emergencyContactPhone);
      if (cleanEmerPhone.length !== 10) {
        client.release();
        return res.status(400).json({
          success: false,
          message: "Emergency contact phone must be exactly 10 digits",
        });
      }
      if (!isValidPhone(cleanEmerPhone)) {
        client.release();
        return res.status(400).json({
          success: false,
          message: "Emergency contact phone must be a valid 10-digit mobile number starting with 6, 7, 8, or 9",
        });
      }
    }

    // Verify target branch
    const branchResult = await pool.query(
      `SELECT id, gym_id, is_active FROM branches WHERE id = $1 LIMIT 1`,
      [branchId]
    );

    if (branchResult.rows.length === 0) {
      client.release();
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    if (!branchResult.rows[0].is_active) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "Cannot create member in an inactive branch",
      });
    }

    const targetGymId = branchResult.rows[0].gym_id;
    if (req.tenant?.gymId && targetGymId !== req.tenant.gymId) {
      client.release();
      return res.status(403).json({
        success: false,
        message: "Branch does not belong to your gym",
      });
    }

    // Check duplicate phone in target gym
    const dupMember = await pool.query(
      `SELECT m.id
       FROM members m
       JOIN branches b ON b.id = m.branch_id
       WHERE b.gym_id = $1 AND m.phone = $2
       LIMIT 1`,
      [targetGymId, cleanPhone]
    );

    if (dupMember.rows.length > 0) {
      client.release();
      return res.status(400).json({
        success: false,
        message: "A member with this phone number already exists in this gym",
      });
    }

    // Begin atomic transaction
    await client.query("BEGIN");

    // Concurrency lock check
    const lockRes = await client.query(
      `SELECT id, status, converted_member_id FROM leads WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (lockRes.rows.length === 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    if (lockRes.rows[0].status === "Converted" || lockRes.rows[0].converted_member_id) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(400).json({
        success: false,
        message: "Lead has already been converted to a member",
      });
    }

    // 1. Insert member
    const memberResult = await client.query(
      `INSERT INTO members (
        branch_id, referred_by, date_of_birth, gender, address, profile_photo_url,
        emergency_contact_name, emergency_contact_phone, full_name, email, phone,
        health_notes, join_date
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13
      )
      RETURNING *`,
      [
        branchId,
        referredBy ?? null,
        dateOfBirth ?? null,
        gender ?? null,
        address ?? null,
        profilePhotoUrl ?? null,
        emergencyContactName ?? null,
        cleanEmerPhone ?? null,
        fullName,
        email?.trim().toLowerCase() || null,
        cleanPhone,
        healthNotes ?? null,
        joinDate ?? null,
      ]
    );
    const newMember = memberResult.rows[0];

    // 2. Update lead status to Converted and set converted_member_id
    const leadUpdateResult = await client.query(
      `UPDATE leads
       SET status = 'Converted',
           converted_member_id = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [newMember.id, id]
    );

    // 3. Insert interaction note
    await client.query(
      `INSERT INTO lead_interactions (
        lead_id, interaction_type, notes, done_by, interaction_date
      )
      VALUES ($1, 'system', $2, $3, CURRENT_TIMESTAMP)`,
      [id, `Lead converted to member (${newMember.full_name}).`, req.user?.id || null]
    );

    await client.query("COMMIT");
    client.release();

    // Notification Service (non-blocking)
    try {
      await notificationService.sendMemberWelcome({
        gymId: targetGymId,
        memberId: newMember.id,
        phone: newMember.phone,
        name: newMember.full_name,
      });
    } catch (notifError) {
      console.error("Failed to send welcome SMS:", notifError);
    }

    return res.status(201).json({
      success: true,
      message: "Lead converted to member successfully",
      data: {
        member: newMember,
        lead: leadUpdateResult.rows[0],
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    client.release();
    next(error);
  }
};

module.exports = {
  createLead,
  getLeads,
  updateLead,
  deleteLead,
  getLeadInteractions,
  addLeadInteraction,
  deleteLeadInteraction,
  convertLeadToMember,
};
