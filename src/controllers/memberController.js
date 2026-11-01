const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");
const notificationService = require("../services/notificationService");
const { sanitizePhone, isValidPhone } = require("../utils/phoneValidation");
const {
  expireOverdueMemberships,
  resumeExpiredFreezes,
} = require("../services/membershipExpiryService");

// ======================================================
// CREATE MEMBER
// ======================================================

const createMember = async (req, res, next) => {
  try {
    const {
      branchId,
      referredBy,
      dateOfBirth,
      gender,
      address,
      profilePhotoUrl,
      emergencyContactName,
      emergencyContactPhone,
      fullName,
      email,
      phone,
      healthNotes,
      joinDate,
    } = req.body;

    if (!branchId || !fullName || !fullName.trim() || !phone) {
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
        return res.status(400).json({
          success: false,
          message: "Date of birth cannot be in the future",
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

    let cleanEmerPhone = null;
    if (emergencyContactPhone && String(emergencyContactPhone).trim()) {
      cleanEmerPhone = sanitizePhone(emergencyContactPhone);
      if (cleanEmerPhone.length !== 10) {
        return res.status(400).json({
          success: false,
          message: "Emergency contact phone must be exactly 10 digits",
        });
      }
      if (!isValidPhone(cleanEmerPhone)) {
        return res.status(400).json({
          success: false,
          message: "Emergency contact phone must be a valid 10-digit mobile number starting with 6, 7, 8, or 9",
        });
      }
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
        message: "Cannot create member in an inactive branch",
      });
    }

    if (req.tenant?.gymId && branchResult.rows[0].gym_id !== req.tenant.gymId) {
      return res.status(403).json({
        success: false,
        message: "Branch does not belong to your gym",
      });
    }

    // Reject duplicate phone numbers inside the same gym
    const dupMember = await pool.query(
      `
      SELECT m.id
      FROM members m
      JOIN branches b ON b.id = m.branch_id
      WHERE b.gym_id = $1 AND m.phone = $2
      LIMIT 1
      `,
      [branchResult.rows[0].gym_id, cleanPhone]
    );

    if (dupMember.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "A member with this phone number already exists in this gym",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO members (
        branch_id,
        referred_by,
        date_of_birth,
        gender,
        address,
        profile_photo_url,
        emergency_contact_name,
        emergency_contact_phone,
        full_name,
        email,
        phone,
        health_notes,
        join_date
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13
      )
      RETURNING
        id,
        branch_id,
        user_id,
        referred_by,
        date_of_birth,
        gender,
        address,
        profile_photo_url,
        emergency_contact_name,
        emergency_contact_phone,
        full_name,
        email,
        phone,
        health_notes,
        join_date,
        is_active,
        created_at,
        updated_at
      `,
      [
        branchId,
        referredBy ?? null,
        dateOfBirth ?? null,
        gender ?? null,
        address ?? null,
        profilePhotoUrl ?? null,
        emergencyContactName ?? null,
        cleanEmerPhone ?? null,
        fullName.trim(),
        email?.trim().toLowerCase() || null,
        cleanPhone,
        healthNotes ?? null,
        joinDate ?? null,
      ]
    );

    // Trigger Notification Service
    try {
      const gymId = branchResult.rows[0].gym_id;
      await notificationService.sendMemberWelcome({
        gymId,
        memberId: result.rows[0].id,
        phone: result.rows[0].phone,
        name: result.rows[0].full_name
      });
    } catch (notifError) {
      console.error("Failed to send welcome SMS:", notifError);
      // We don't fail the member creation if SMS fails
    }

    return res.status(201).json({
      success: true,
      message: "Member created successfully",
      data: {
        member: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ALL MEMBERS
// ======================================================

const getMembers = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const status = req.query.status || "all";
    const joinDate = req.query.joinDate || "all";
    const branchId = req.query.branchId;
    const gymId = req.query.gymId;
    const offset = (page - 1) * limit;

    // Eagerly sync auto-expiry and resumes
    try {
      await resumeExpiredFreezes();
      await expireOverdueMemberships();
    } catch (autoErr) {
      console.error("Auto membership status sync failed:", autoErr);
    }

    let baseQuery = `FROM members m 
    LEFT JOIN branches b ON b.id = m.branch_id 
    LEFT JOIN gyms g ON g.id = b.gym_id
    LEFT JOIN LATERAL (
      SELECT 
        mp.name as plan_name, 
        mm.end_date as expiry_date, 
        mm.plan_id,
        mm.id as membership_id,
        CASE 
          WHEN mm.status = 'on_hold' THEN 'on_hold'
          WHEN mm.end_date < CURRENT_DATE THEN 'expired'
          ELSE mm.status
        END as membership_status,
        mm.freeze_start,
        mm.freeze_end,
        mp.max_freeze_days,
        COALESCE(mp.freeze_fee, 0) as plan_freeze_fee
      FROM member_memberships mm
      JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.member_id = m.id
      ORDER BY 
        CASE 
          WHEN mm.status = 'on_hold' THEN 1
          WHEN mm.status = 'active' AND mm.end_date >= CURRENT_DATE THEN 2
          ELSE 3
        END ASC,
        mm.end_date DESC
      LIMIT 1
    ) active_plan ON true`;
    let countParams = [];
    let dataParams = [];

    let hasWhere = false;

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      baseQuery += hasWhere ? ` AND b.gym_id = $${countParams.length + 1}` : ` WHERE b.gym_id = $${countParams.length + 1}`;
      hasWhere = true;
      countParams.push(req.tenant.gymId);
      dataParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view members",
      });
    }

    // Role-based branch scoping (if assigned to a specific branch)
    if (req.user.branch_id) {
      baseQuery += hasWhere ? ` AND m.branch_id = $${countParams.length + 1}` : ` WHERE m.branch_id = $${countParams.length + 1}`;
      hasWhere = true;
      countParams.push(req.user.branch_id);
      dataParams.push(req.user.branch_id);
    } else if (branchId) {
      baseQuery += hasWhere ? ` AND m.branch_id = $${countParams.length + 1}` : ` WHERE m.branch_id = $${countParams.length + 1}`;
      hasWhere = true;
      countParams.push(branchId);
      dataParams.push(branchId);
    }

    // System-admin optional explicit gym filter
    if (req.tenant?.isSystemAdmin && gymId) {
      baseQuery += hasWhere ? ` AND b.gym_id = $${countParams.length + 1}` : ` WHERE b.gym_id = $${countParams.length + 1}`;
      hasWhere = true;
      countParams.push(gymId);
      dataParams.push(gymId);
    }

    // Search Condition
    if (search) {
      const searchStr = `%${search}%`;
      const searchCondition = `(m.full_name ILIKE $${countParams.length + 1} OR m.email ILIKE $${countParams.length + 1} OR m.phone ILIKE $${countParams.length + 1})`;
      
      baseQuery += hasWhere ? ` AND ${searchCondition}` : ` WHERE ${searchCondition}`;
      hasWhere = true;
      
      countParams.push(searchStr);
      dataParams.push(searchStr);
    }

    // Status Filter
    if (status === 'active') {
      baseQuery += hasWhere ? ` AND m.is_active = true` : ` WHERE m.is_active = true`;
      hasWhere = true;
    } else if (status === 'inactive') {
      baseQuery += hasWhere ? ` AND m.is_active = false` : ` WHERE m.is_active = false`;
      hasWhere = true;
    } else if (status === 'expiring_soon' || status === 'expiring_7_days') {
      baseQuery += hasWhere 
        ? ` AND active_plan.membership_status = 'active' AND active_plan.expiry_date >= CURRENT_DATE AND active_plan.expiry_date <= CURRENT_DATE + INTERVAL '7 days'`
        : ` WHERE active_plan.membership_status = 'active' AND active_plan.expiry_date >= CURRENT_DATE AND active_plan.expiry_date <= CURRENT_DATE + INTERVAL '7 days'`;
      hasWhere = true;
    } else if (status === 'expired') {
      baseQuery += hasWhere 
        ? ` AND (active_plan.membership_status = 'expired' OR (active_plan.expiry_date IS NOT NULL AND active_plan.expiry_date < CURRENT_DATE))`
        : ` WHERE (active_plan.membership_status = 'expired' OR (active_plan.expiry_date IS NOT NULL AND active_plan.expiry_date < CURRENT_DATE))`;
      hasWhere = true;
    } else if (status === 'on_hold') {
      baseQuery += hasWhere 
        ? ` AND active_plan.membership_status = 'on_hold'`
        : ` WHERE active_plan.membership_status = 'on_hold'`;
      hasWhere = true;
    }

    // Join Date Filter
    if (joinDate === 'last30') {
      baseQuery += hasWhere ? ` AND m.join_date >= NOW() - INTERVAL '30 days'` : ` WHERE m.join_date >= NOW() - INTERVAL '30 days'`;
      hasWhere = true;
    } else if (joinDate === 'thisYear') {
      baseQuery += hasWhere ? ` AND EXTRACT(YEAR FROM m.join_date) = EXTRACT(YEAR FROM NOW())` : ` WHERE EXTRACT(YEAR FROM m.join_date) = EXTRACT(YEAR FROM NOW())`;
      hasWhere = true;
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
        m.id,
        m.branch_id,
        b.name AS branch_name,
        b.gym_id,
        g.name AS gym_name,
        m.user_id,
        m.referred_by,
        m.date_of_birth,
        m.gender,
        m.address,
        m.profile_photo_url,
        m.emergency_contact_name,
        m.emergency_contact_phone,
        m.full_name,
        m.email,
        m.phone,
        m.health_notes,
        m.join_date,
        m.is_active,
        m.created_at,
        m.updated_at,
        active_plan.plan_name,
        active_plan.expiry_date,
        active_plan.plan_id,
        active_plan.membership_id,
        active_plan.membership_status,
        active_plan.freeze_start,
        active_plan.freeze_end,
        active_plan.max_freeze_days,
        active_plan.plan_freeze_fee
      ${baseQuery}
      ORDER BY m.created_at DESC
      ${limitOffsetCondition}
    `;

    const result = await pool.query(dataQuery, dataParams);

    return res.status(200).json({
      success: true,
      data: {
        members: result.rows,
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
// EXPORT MEMBERS (AJAX/CSV)
// ======================================================

const exportMembers = async (req, res, next) => {
  try {
    const search = req.query.search || "";
    const status = req.query.status || "all";
    const joinDate = req.query.joinDate || "all";
    const branchId = req.query.branchId;
    const gymId = req.query.gymId;

    let baseQuery = `FROM members m 
    LEFT JOIN branches b ON b.id = m.branch_id 
    LEFT JOIN gyms g ON g.id = b.gym_id
    LEFT JOIN LATERAL (
      SELECT 
        mp.name as plan_name, 
        mm.end_date as expiry_date, 
        mm.plan_id,
        CASE 
          WHEN mm.status = 'on_hold' THEN 'on_hold'
          WHEN mm.end_date < CURRENT_DATE THEN 'expired'
          ELSE mm.status
        END as membership_status
      FROM member_memberships mm
      JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.member_id = m.id
      ORDER BY 
        CASE 
          WHEN mm.status = 'on_hold' THEN 1
          WHEN mm.status = 'active' AND mm.end_date >= CURRENT_DATE THEN 2
          ELSE 3
        END ASC,
        mm.end_date DESC
      LIMIT 1
    ) active_plan ON true`;
    let dataParams = [];
    let hasWhere = false;

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      baseQuery += hasWhere ? ` AND b.gym_id = $${dataParams.length + 1}` : ` WHERE b.gym_id = $${dataParams.length + 1}`;
      hasWhere = true;
      dataParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to export members",
      });
    }

    // Role-based branch scoping (if assigned to a specific branch)
    if (req.user.branch_id) {
      baseQuery += hasWhere ? ` AND m.branch_id = $${dataParams.length + 1}` : ` WHERE m.branch_id = $${dataParams.length + 1}`;
      hasWhere = true;
      dataParams.push(req.user.branch_id);
    } else if (branchId) {
      baseQuery += hasWhere ? ` AND m.branch_id = $${dataParams.length + 1}` : ` WHERE m.branch_id = $${dataParams.length + 1}`;
      hasWhere = true;
      dataParams.push(branchId);
    }

    // System-admin optional explicit gym filter
    if (req.tenant?.isSystemAdmin && gymId) {
      baseQuery += hasWhere ? ` AND b.gym_id = $${dataParams.length + 1}` : ` WHERE b.gym_id = $${dataParams.length + 1}`;
      hasWhere = true;
      dataParams.push(gymId);
    }

    // Search Condition
    if (search) {
      const searchStr = `%${search}%`;
      const searchCondition = `(m.full_name ILIKE $${dataParams.length + 1} OR m.email ILIKE $${dataParams.length + 1} OR m.phone ILIKE $${dataParams.length + 1})`;
      baseQuery += hasWhere ? ` AND ${searchCondition}` : ` WHERE ${searchCondition}`;
      dataParams.push(searchStr);
      hasWhere = true;
    }

    // Status Filter
    if (status === 'active') {
      baseQuery += hasWhere ? ` AND m.is_active = true` : ` WHERE m.is_active = true`;
      hasWhere = true;
    } else if (status === 'inactive') {
      baseQuery += hasWhere ? ` AND m.is_active = false` : ` WHERE m.is_active = false`;
      hasWhere = true;
    } else if (status === 'expiring_soon' || status === 'expiring_7_days') {
      baseQuery += hasWhere 
        ? ` AND active_plan.membership_status = 'active' AND active_plan.expiry_date >= CURRENT_DATE AND active_plan.expiry_date <= CURRENT_DATE + INTERVAL '7 days'`
        : ` WHERE active_plan.membership_status = 'active' AND active_plan.expiry_date >= CURRENT_DATE AND active_plan.expiry_date <= CURRENT_DATE + INTERVAL '7 days'`;
      hasWhere = true;
    } else if (status === 'expired') {
      baseQuery += hasWhere 
        ? ` AND (active_plan.membership_status = 'expired' OR (active_plan.expiry_date IS NOT NULL AND active_plan.expiry_date < CURRENT_DATE))`
        : ` WHERE (active_plan.membership_status = 'expired' OR (active_plan.expiry_date IS NOT NULL AND active_plan.expiry_date < CURRENT_DATE))`;
      hasWhere = true;
    } else if (status === 'on_hold') {
      baseQuery += hasWhere 
        ? ` AND active_plan.membership_status = 'on_hold'`
        : ` WHERE active_plan.membership_status = 'on_hold'`;
      hasWhere = true;
    }

    // Join Date Filter
    if (joinDate === 'last30') {
      baseQuery += hasWhere ? ` AND m.join_date >= NOW() - INTERVAL '30 days'` : ` WHERE m.join_date >= NOW() - INTERVAL '30 days'`;
      hasWhere = true;
    } else if (joinDate === 'thisYear') {
      baseQuery += hasWhere ? ` AND EXTRACT(YEAR FROM m.join_date) = EXTRACT(YEAR FROM NOW())` : ` WHERE EXTRACT(YEAR FROM m.join_date) = EXTRACT(YEAR FROM NOW())`;
      hasWhere = true;
    }

    const dataQuery = `
      SELECT
        m.id,
        m.branch_id,
        b.name AS branch_name,
        g.name AS gym_name,
        m.full_name,
        m.email,
        m.phone,
        m.join_date,
        m.is_active,
        active_plan.plan_name,
        active_plan.expiry_date,
        active_plan.membership_status
      ${baseQuery}
      ORDER BY m.created_at DESC
    `;

    const result = await pool.query(dataQuery, dataParams);
    const members = result.rows;

    const headers = ["Sno", "Name", "Email", "Phone", "Plan", "Expiry", "Gym", "Branch", "Status"];
    const csvRows = [headers.join(",")];

    members.forEach((m, index) => {
      const planLabel = m.membership_status === 'on_hold' 
        ? `${m.plan_name || 'Plan'} (On Hold)` 
        : (m.plan_name || 'No plan');

      const statusLabel = m.membership_status === 'on_hold' 
        ? "On Hold" 
        : (m.is_active ? "Active" : "Inactive");

      const row = [
        index + 1,
        `"${m.full_name || ''}"`,
        `"${m.email || ''}"`,
        `"${m.phone || ''}"`,
        `"${planLabel}"`,
        `"${m.expiry_date ? new Date(m.expiry_date).toLocaleDateString() : ''}"`,
        `"${m.gym_name || ''}"`,
        `"${m.branch_name || ''}"`,
        statusLabel
      ];
      csvRows.push(row.join(","));
    });

    const csvContent = csvRows.join("\n");
    
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=Members_Export_${new Date().toISOString().split('T')[0]}.csv`);
    return res.send(csvContent);

  } catch (error) {
    next(error);
  }
};

// ======================================================
// IMPORT MEMBERS (BATCH CSV)
// ======================================================

const parseDateSafe = (val) => {
  if (!val) return null;
  const str = String(val).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const parts = str.split(/[\/\-\.]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      const year = parts[0];
      const month = String(parts[1]).padStart(2, "0");
      const day = String(parts[2]).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    if (parts[2].length === 4) {
      const year = parts[2];
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      if (p0 > 12 && p1 <= 12) {
        return `${year}-${String(p1).padStart(2, "0")}-${String(p0).padStart(2, "0")}`;
      } else if (p1 > 12 && p0 <= 12) {
        return `${year}-${String(p0).padStart(2, "0")}-${String(p1).padStart(2, "0")}`;
      }
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return null;
};

const importMembers = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { branchId, members } = req.body;

    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No members provided for import",
      });
    }

    // Role-based branch access validation using shared helper (Day 2 Prompt 2)
    const branchAccess = resolveBranchAccess(req);
    let branchQuery = `SELECT b.id, b.name, b.gym_id, b.is_active FROM branches b`;
    let branchParams = [];

    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      branchQuery += ` WHERE b.id = $1`;
      branchParams.push(branchAccess.branchId);
      if (branchAccess.gymId) {
        branchQuery += ` AND b.gym_id = $2`;
        branchParams.push(branchAccess.gymId);
      }
    } else if (branchAccess.gymId) {
      branchQuery += ` WHERE b.gym_id = $1`;
      branchParams.push(branchAccess.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to import members",
      });
    }

    const branchesRes = await client.query(branchQuery, branchParams);
    const accessibleBranches = branchesRes.rows;

    const branchMapById = new Map();
    const branchMapByName = new Map();
    for (const b of accessibleBranches) {
      branchMapById.set(b.id, b);
      branchMapByName.set(b.name.trim().toLowerCase(), b);
    }

    // Default branch selection
    let defaultBranch = null;
    if (branchId) {
      defaultBranch = branchMapById.get(branchId);
      if (!defaultBranch && req.user.role_name === "system-admin") {
        const bRes = await client.query("SELECT id, name, gym_id, is_active FROM branches WHERE id = $1", [branchId]);
        if (bRes.rows.length > 0) {
          defaultBranch = bRes.rows[0];
          branchMapById.set(defaultBranch.id, defaultBranch);
          branchMapByName.set(defaultBranch.name.trim().toLowerCase(), defaultBranch);
        }
      }
    } else if (req.user.branch_id && branchMapById.has(req.user.branch_id)) {
      defaultBranch = branchMapById.get(req.user.branch_id);
    } else if (accessibleBranches.length === 1) {
      defaultBranch = accessibleBranches[0];
    }

    const imported = [];
    const skipped = [];
    const seenPhonesInBatch = new Set();

    await client.query("BEGIN");

    for (let i = 0; i < members.length; i++) {
      const row = members[i];
      const rowNum = row.rowNumber || (i + 1);
      const fullName = (row.fullName || row.name || "").trim();
      const rawPhone = row.phone || row.contact || "";
      const cleanPhone = sanitizePhone(rawPhone);
      const email = (row.email || "").trim().toLowerCase() || null;
      const gender = (row.gender || "").trim() || null;
      const dateOfBirth = parseDateSafe(row.dateOfBirth || row.dob);
      const address = (row.address || "").trim() || null;
      const emergencyContactName = (row.emergencyContactName || "").trim() || null;
      const emergencyContactPhone = row.emergencyContactPhone ? sanitizePhone(row.emergencyContactPhone) : null;
      const healthNotes = (row.healthNotes || "").trim() || null;
      const joinDate = parseDateSafe(row.joinDate) || new Date().toISOString().split("T")[0];
      const isActive = row.status !== undefined 
        ? String(row.status).trim().toLowerCase() !== "inactive" 
        : true;

      // Validate full name
      if (!fullName) {
        skipped.push({
          row: rowNum,
          name: "Unknown",
          phone: rawPhone,
          reason: "Full name is required",
        });
        continue;
      }

      // Validate phone
      if (!cleanPhone || cleanPhone.length !== 10) {
        skipped.push({
          row: rowNum,
          name: fullName,
          phone: rawPhone,
          reason: "Phone number must be exactly 10 digits",
        });
        continue;
      }
      if (!isValidPhone(cleanPhone)) {
        skipped.push({
          row: rowNum,
          name: fullName,
          phone: rawPhone,
          reason: "Phone number must be a valid 10-digit mobile number starting with 6, 7, 8, or 9",
        });
        continue;
      }

      // Validate emergency contact phone if provided
      if (emergencyContactPhone) {
        if (emergencyContactPhone.length !== 10) {
          skipped.push({
            row: rowNum,
            name: fullName,
            phone: cleanPhone,
            reason: "Emergency contact phone must be exactly 10 digits",
          });
          continue;
        }
        if (!isValidPhone(emergencyContactPhone)) {
          skipped.push({
            row: rowNum,
            name: fullName,
            phone: cleanPhone,
            reason: "Emergency contact phone must be a valid 10-digit mobile number starting with 6, 7, 8, or 9",
          });
          continue;
        }
      }

      // Validate email
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          skipped.push({
            row: rowNum,
            name: fullName,
            phone: cleanPhone,
            reason: `Invalid email address: ${email}`,
          });
          continue;
        }
      }

      // Validate date of birth
      if (dateOfBirth) {
        const dob = new Date(dateOfBirth);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (isNaN(dob.getTime()) || dob > today) {
          skipped.push({
            row: rowNum,
            name: fullName,
            phone: cleanPhone,
            reason: "Date of birth cannot be in the future",
          });
          continue;
        }
      }

      // Determine target branch
      let targetBranch = defaultBranch;
      if (row.branchName) {
        const matched = branchMapByName.get(row.branchName.trim().toLowerCase());
        if (matched) {
          targetBranch = matched;
        }
      }

      if (!targetBranch) {
        skipped.push({
          row: rowNum,
          name: fullName,
          phone: cleanPhone,
          reason: "Target branch could not be determined. Please select a branch or provide a valid branch name.",
        });
        continue;
      }

      if (!targetBranch.is_active) {
        skipped.push({
          row: rowNum,
          name: fullName,
          phone: cleanPhone,
          reason: `Branch "${targetBranch.name}" is inactive`,
        });
        continue;
      }

      // Check duplicates within the file batch for this gym
      const batchKey = `${targetBranch.gym_id}_${cleanPhone}`;
      if (seenPhonesInBatch.has(batchKey)) {
        skipped.push({
          row: rowNum,
          name: fullName,
          phone: cleanPhone,
          reason: `Duplicate phone number within this import file for this gym`,
        });
        continue;
      }
      seenPhonesInBatch.add(batchKey);

      // Check duplicate in database for this gym
      const existingMember = await client.query(
        `SELECT m.id, m.full_name, b.name AS branch_name
         FROM members m
         JOIN branches b ON b.id = m.branch_id
         WHERE b.gym_id = $1 AND m.phone = $2
         LIMIT 1`,
        [targetBranch.gym_id, cleanPhone]
      );

      if (existingMember.rows.length > 0) {
        skipped.push({
          row: rowNum,
          name: fullName,
          phone: cleanPhone,
          reason: `A member with phone ${cleanPhone} already exists in this gym (${existingMember.rows[0].branch_name}: ${existingMember.rows[0].full_name})`,
        });
        continue;
      }

      // Insert member
      const insertResult = await client.query(
        `
        INSERT INTO members (
          branch_id,
          full_name,
          email,
          phone,
          gender,
          date_of_birth,
          address,
          emergency_contact_name,
          emergency_contact_phone,
          health_notes,
          join_date,
          is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        RETURNING id, full_name, phone, email, branch_id
        `,
        [
          targetBranch.id,
          fullName,
          email,
          cleanPhone,
          gender,
          dateOfBirth,
          address,
          emergencyContactName,
          emergencyContactPhone,
          healthNotes,
          joinDate,
          isActive,
        ]
      );

      imported.push({
        id: insertResult.rows[0].id,
        name: insertResult.rows[0].full_name,
        phone: insertResult.rows[0].phone,
        branch: targetBranch.name,
      });
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Import completed: ${imported.length} imported successfully, ${skipped.length} skipped.`,
      data: {
        total: members.length,
        importedCount: imported.length,
        skippedCount: skipped.length,
        imported,
        skipped,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

// ======================================================
// GET MEMBER BY ID
// ======================================================

const getMemberById = async (req, res, next) => {
  try {
    const { id } = req.params;

    let tenantFilter = "";
    const params = [id];
    if (req.tenant?.gymId) {
      tenantFilter = ` AND b.gym_id = $2`;
      params.push(req.tenant.gymId);
    }

    const result = await pool.query(
      `
      SELECT
        m.id,
        m.branch_id,
        b.name AS branch_name,
        b.gym_id,
        g.name AS gym_name,
        m.user_id,
        m.referred_by,
        m.date_of_birth,
        m.gender,
        m.address,
        m.profile_photo_url,
        m.emergency_contact_name,
        m.emergency_contact_phone,
        m.full_name,
        m.email,
        m.phone,
        m.health_notes,
        m.join_date,
        m.is_active,
        m.created_at,
        m.updated_at,
        active_plan.plan_name,
        active_plan.expiry_date,
        active_plan.plan_id,
        active_plan.membership_id,
        active_plan.membership_status,
        active_plan.freeze_start,
        active_plan.freeze_end,
        active_plan.max_freeze_days
      FROM members m
      LEFT JOIN branches b
        ON b.id = m.branch_id
      LEFT JOIN gyms g
        ON g.id = b.gym_id
      LEFT JOIN LATERAL (
        SELECT 
          mp.name as plan_name, 
          mm.end_date as expiry_date, 
          mm.plan_id,
          mm.id as membership_id,
          CASE 
            WHEN mm.status = 'on_hold' THEN 'on_hold'
            WHEN mm.end_date < CURRENT_DATE THEN 'expired'
            ELSE mm.status
          END as membership_status,
          mm.freeze_start,
          mm.freeze_end,
          mp.max_freeze_days,
          COALESCE(mp.freeze_fee, 0) as plan_freeze_fee
        FROM member_memberships mm
        JOIN membership_plans mp ON mp.id = mm.plan_id
        WHERE mm.member_id = m.id
        ORDER BY 
          CASE 
            WHEN mm.status = 'on_hold' THEN 1
            WHEN mm.status = 'active' AND mm.end_date >= CURRENT_DATE THEN 2
            ELSE 3
          END ASC,
          mm.end_date DESC
        LIMIT 1
      ) active_plan ON true
      WHERE m.id = $1 ${tenantFilter}
      LIMIT 1
      `,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    // Fetch payment history for this member
    const paymentsResult = await pool.query(
      `
      SELECT 
        p.id,
        p.amount,
        p.payment_mode,
        p.payment_ref,
        p.payment_date,
        p.status,
        p.notes,
        p.created_at,
        mp.name AS plan_name,
        mm.start_date,
        mm.end_date
      FROM payments p
      LEFT JOIN member_memberships mm ON p.membership_id = mm.id
      LEFT JOIN membership_plans mp ON mm.plan_id = mp.id
      WHERE p.member_id = $1
      ORDER BY p.payment_date DESC, p.created_at DESC
      `,
      [id]
    );

    // Fetch full membership renewal history for this member
    const membershipsResult = await pool.query(
      `
      SELECT 
        mm.id,
        mm.plan_id,
        mm.start_date,
        mm.end_date,
        CASE 
          WHEN mm.status = 'on_hold' THEN 'on_hold'
          WHEN mm.end_date < CURRENT_DATE THEN 'expired'
          ELSE mm.status
        END AS status,
        mm.freeze_start,
        mm.freeze_end,
        mm.created_at,
        mp.name AS plan_name,
        mp.duration_days,
        mp.price AS plan_price
      FROM member_memberships mm
      LEFT JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.member_id = $1
      ORDER BY mm.end_date DESC, mm.start_date DESC
      `,
      [id]
    );

    return res.status(200).json({
      success: true,
      data: {
        member: {
          ...result.rows[0],
          payments: paymentsResult.rows,
          memberships: membershipsResult.rows,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE MEMBER
// ======================================================

const updateMember = async (req, res, next) => {
  try {
    const { id } = req.params;

    const {
      branchId,
      referredBy,
      dateOfBirth,
      gender,
      address,
      profilePhotoUrl,
      emergencyContactName,
      emergencyContactPhone,
      fullName,
      email,
      phone,
      healthNotes,
      joinDate,
      isActive,
    } = req.body;

    // --------------------------------------------------
    // Check member
    // --------------------------------------------------

    const memberResult = await pool.query(
      `
      SELECT
        m.id,
        m.branch_id,
        m.user_id,
        m.email,
        b.gym_id
      FROM members m
      LEFT JOIN branches b ON b.id = m.branch_id
      WHERE m.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (
      memberResult.rows.length === 0 ||
      (req.tenant?.gymId && memberResult.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    if (fullName !== undefined && (!fullName || !fullName.trim())) {
      return res.status(400).json({
        success: false,
        message: "Full name is required",
      });
    }

    if (dateOfBirth !== undefined && dateOfBirth) {
      const dob = new Date(dateOfBirth);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (isNaN(dob.getTime()) || dob > today) {
        return res.status(400).json({
          success: false,
          message: "Date of birth cannot be in the future",
        });
      }
    }

    // --------------------------------------------------
    // Validate new branch if provided
    // --------------------------------------------------

    if (branchId && branchId !== memberResult.rows[0].branch_id) {
      const bRes = await pool.query("SELECT id, gym_id FROM branches WHERE id = $1", [branchId]);
      if (
        bRes.rows.length === 0 ||
        (req.tenant?.gymId && bRes.rows[0].gym_id !== req.tenant.gymId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Target branch not found in your gym",
        });
      }
    }

    let cleanPhone = undefined;
    if (phone !== undefined) {
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

      const targetGymId = (branchId && branchId !== memberResult.rows[0].branch_id)
        ? (await pool.query("SELECT gym_id FROM branches WHERE id = $1", [branchId])).rows[0]?.gym_id
        : memberResult.rows[0].gym_id;

      if (targetGymId) {
        const dupMember = await pool.query(
          `
          SELECT m.id
          FROM members m
          JOIN branches b ON b.id = m.branch_id
          WHERE b.gym_id = $1 AND m.phone = $2 AND m.id != $3
          LIMIT 1
          `,
          [targetGymId, cleanPhone, id]
        );

        if (dupMember.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message: "A member with this phone number already exists in this gym",
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

    let cleanEmerPhone = undefined;
    if (emergencyContactPhone !== undefined && emergencyContactPhone && String(emergencyContactPhone).trim()) {
      cleanEmerPhone = sanitizePhone(emergencyContactPhone);
      if (cleanEmerPhone.length !== 10) {
        return res.status(400).json({
          success: false,
          message: "Emergency contact phone must be exactly 10 digits",
        });
      }
      if (!isValidPhone(cleanEmerPhone)) {
        return res.status(400).json({
          success: false,
          message: "Emergency contact phone must be a valid 10-digit mobile number starting with 6, 7, 8, or 9",
        });
      }
    }

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
          message: "Cannot move member to an inactive branch",
        });
      }
    }

    // --------------------------------------------------
    // Update member
    // --------------------------------------------------

    const result = await pool.query(
      `
      UPDATE members
      SET
        branch_id = COALESCE($1::uuid, branch_id),
        referred_by = COALESCE($2::uuid, referred_by),
        date_of_birth = COALESCE($3::date, date_of_birth),
        gender = COALESCE($4::text, gender),
        address = COALESCE($5::text, address),
        profile_photo_url = COALESCE($6::text, profile_photo_url),
        emergency_contact_name = COALESCE($7::text, emergency_contact_name),
        emergency_contact_phone = COALESCE($8::text, emergency_contact_phone),
        full_name = COALESCE($9::text, full_name),
        email = COALESCE($10::text, email),
        phone = COALESCE($11::text, phone),
        health_notes = COALESCE($12::text, health_notes),
        join_date = COALESCE($13::date, join_date),
        is_active = COALESCE($14::boolean, is_active),
        updated_at = NOW()
      WHERE id = $15::uuid
      RETURNING
        id,
        branch_id,
        user_id,
        referred_by,
        date_of_birth,
        gender,
        address,
        profile_photo_url,
        emergency_contact_name,
        emergency_contact_phone,
        full_name,
        email,
        phone,
        health_notes,
        join_date,
        is_active,
        created_at,
        updated_at
      `,
      [
        branchId ?? null,
        referredBy ?? null,
        dateOfBirth ?? null,
        gender ?? null,
        address ?? null,
        profilePhotoUrl ?? null,
        emergencyContactName ?? null,
        emergencyContactPhone !== undefined ? (cleanEmerPhone ?? null) : null,
        fullName?.trim() || null,
        email?.trim().toLowerCase() || null,
        phone !== undefined ? cleanPhone : null,
        healthNotes ?? null,
        joinDate ?? null,
        isActive ?? null,
        id,
      ]
    );

    const updatedMember = result.rows[0];
    const originalEmail = memberResult.rows[0].email;

    // --------------------------------------------------
    // Update linked user if exists
    // --------------------------------------------------

    if (updatedMember.user_id) {
      await pool.query(
        `
        UPDATE users
        SET
          email = COALESCE($1::text, email),
          full_name = COALESCE($2::text, full_name),
          phone = COALESCE($3::text, phone),
          is_active = COALESCE($4::boolean, is_active),
          updated_at = NOW()
        WHERE id = $5::uuid
        `,
        [
          email?.trim().toLowerCase() || null,
          fullName?.trim() || null,
          phone?.trim() || null,
          isActive ?? null,
          updatedMember.user_id,
        ]
      );
    } else if (originalEmail) {
      await pool.query(
        `
        UPDATE users
        SET
          email = COALESCE($1::text, email),
          full_name = COALESCE($2::text, full_name),
          phone = COALESCE($3::text, phone),
          is_active = COALESCE($4::boolean, is_active),
          updated_at = NOW()
        WHERE email = $5::text
        `,
        [
          email?.trim().toLowerCase() || null,
          fullName?.trim() || null,
          phone?.trim() || null,
          isActive ?? null,
          originalEmail,
        ]
      );
    }

    return res.status(200).json({
      success: true,
      message: "Member updated successfully",
      data: {
        member: updatedMember,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DEACTIVATE MEMBER
// ======================================================

const deleteMember = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user?.role_name !== "system-admin" && req.user?.role_name !== "super-admin" && req.user?.role_name !== "admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete members",
      });
    }

    // Check ownership against tenant
    const checkRes = await pool.query(
      `SELECT m.id, b.gym_id FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = $1`,
      [id]
    );

    if (
      checkRes.rows.length === 0 ||
      (req.tenant?.gymId && checkRes.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const result = await pool.query(
      `
      UPDATE members
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
        message: "Member not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Member deactivated successfully",
      data: {
        member: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// HARD DELETE MEMBER
// ======================================================

const hardDeleteMember = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check ownership against tenant
    const checkRes = await pool.query(
      `SELECT m.id, b.gym_id FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = $1`,
      [id]
    );

    if (
      checkRes.rows.length === 0 ||
      (req.tenant?.gymId && checkRes.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    // Check permissions
    if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin" && req.user.role_name !== "admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete members",
      });
    }

    const result = await pool.query(
      `
      DELETE FROM members
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Member deleted permanently",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET MEMBER ACHIEVEMENTS
// ======================================================

const getMemberAchievements = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify member belongs to tenant gym
    const memberCheck = await pool.query(
      `SELECT m.id, b.gym_id FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = $1`,
      [id]
    );

    if (
      memberCheck.rows.length === 0 ||
      (req.tenant?.gymId && memberCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    // 1. Total attendance count
    const attendanceResult = await pool.query(
      `
      SELECT COUNT(*) as total_attendance, 
             MAX(check_in) as last_check_in
      FROM attendance
      WHERE member_id = $1
      `,
      [id]
    );

    const totalAttendance = parseInt(attendanceResult.rows[0].total_attendance, 10);
    const lastCheckIn = attendanceResult.rows[0].last_check_in;

    const achievements = [];

    // Basic achievements logic
    if (totalAttendance >= 1) {
      achievements.push({
        id: "first_visit",
        title: "First Steps",
        description: "Checked in for the first time",
        icon: "🎯",
        dateEarned: lastCheckIn // simplistic approximation
      });
    }

    if (totalAttendance >= 10) {
      achievements.push({
        id: "ten_visits",
        title: "Consistent Earner",
        description: "Checked in 10 times",
        icon: "⭐",
        dateEarned: lastCheckIn
      });
    }

    if (totalAttendance >= 50) {
      achievements.push({
        id: "fifty_visits",
        title: "Gym Rat",
        description: "Checked in 50 times",
        icon: "🏆",
        dateEarned: lastCheckIn
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        achievements,
        stats: {
          totalAttendance,
          lastCheckIn
        }
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// HOLD MEMBER FEES (FREEZE MEMBERSHIP)
// ======================================================

const holdMemberFees = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id: memberId } = req.params;
    const { startDate, endDate, durationDays, reason, freezeFee, paymentMode, paymentRef, notes } = req.body;

    // 1. Verify member belongs to tenant gym and branch
    const memberCheck = await client.query(
      `SELECT m.id, m.branch_id, b.gym_id 
       FROM members m 
       JOIN branches b ON b.id = m.branch_id 
       WHERE m.id = $1`,
      [memberId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const memberBranch = memberCheck.rows[0];
    if (req.tenant?.gymId && memberBranch.gym_id !== req.tenant.gymId) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this member's gym",
      });
    }
    if (req.tenant?.branchId && memberBranch.branch_id !== req.tenant.branchId) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this member's branch",
      });
    }

    // 2. Fetch current membership
    const memRes = await client.query(
      `
      SELECT 
        mm.id, mm.plan_id, mm.start_date, mm.end_date, mm.status,
        mm.freeze_start, mm.freeze_end,
        mp.name as plan_name, mp.max_freeze_days, COALESCE(mp.freeze_fee, 0) as plan_freeze_fee
      FROM member_memberships mm
      JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.member_id = $1
      ORDER BY 
        CASE 
          WHEN mm.status = 'on_hold' THEN 1
          WHEN mm.status = 'active' AND mm.end_date >= CURRENT_DATE THEN 2
          ELSE 3
        END ASC,
        mm.end_date DESC
      LIMIT 1
      `,
      [memberId]
    );

    if (memRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No active membership found for this member to put on hold.",
      });
    }

    const membership = memRes.rows[0];

    // Validate no overlapping freeze: cannot freeze if already on hold
    if (membership.status === "on_hold") {
      return res.status(400).json({
        success: false,
        message: "Member's membership is already on hold (frozen). A freeze cannot overlap another freeze.",
      });
    }

    // Check if membership is expired
    const todayStr = new Date().toISOString().slice(0, 10);
    const membershipEndStr = new Date(membership.end_date).toISOString().slice(0, 10);
    if (membership.status !== "active" || membershipEndStr < todayStr) {
      return res.status(400).json({
        success: false,
        message: "Cannot freeze an expired or inactive membership. Please renew first.",
      });
    }

    const formatLocalDate = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    let startD = startDate ? new Date(startDate) : new Date();
    let endD;
    let daysToHold;

    if (endDate) {
      endD = new Date(endDate);
      const diffMs = endD.getTime() - startD.getTime();
      daysToHold = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (daysToHold <= 0) {
        return res.status(400).json({
          success: false,
          message: "Hold end date must be after hold start date. Frozen days cannot be negative or zero.",
        });
      }
    } else if (durationDays !== undefined && durationDays !== null) {
      daysToHold = parseInt(durationDays, 10);
      if (isNaN(daysToHold) || daysToHold <= 0) {
        return res.status(400).json({
          success: false,
          message: "Hold duration must be greater than 0 days. Frozen days cannot be negative or zero.",
        });
      }
      endD = new Date(startD);
      endD.setDate(startD.getDate() + daysToHold);
    } else {
      return res.status(400).json({
        success: false,
        message: "Hold end date or duration in days is required.",
      });
    }

    if (daysToHold <= 0) {
      return res.status(400).json({
        success: false,
        message: "Frozen days cannot be negative or zero.",
      });
    }

    // Validate max_freeze_days
    if (membership.max_freeze_days > 0 && daysToHold > membership.max_freeze_days) {
      return res.status(400).json({
        success: false,
        message: `Hold duration (${daysToHold} days) exceeds maximum allowed freeze limit of ${membership.max_freeze_days} days for this plan.`,
      });
    }

    const freezeStartStr = formatLocalDate(startD);
    const freezeEndStr = formatLocalDate(endD);

    // Projected expiry date preview: current end_date + daysToHold
    const curEndD = new Date(membership.end_date);
    const projectedEndD = new Date(curEndD);
    projectedEndD.setDate(curEndD.getDate() + daysToHold);
    const projectedEndDateStr = formatLocalDate(projectedEndD);

    // Freeze fee calculation
    const feeToCharge = freezeFee !== undefined && freezeFee !== null && freezeFee !== ""
      ? parseFloat(freezeFee)
      : parseFloat(membership.plan_freeze_fee || 0);

    if (isNaN(feeToCharge) || feeToCharge < 0) {
      return res.status(400).json({
        success: false,
        message: "Freeze fee cannot be negative.",
      });
    }

    await client.query("BEGIN");

    // While frozen, membership is paused (status = 'on_hold')
    const updateRes = await client.query(
      `
      UPDATE member_memberships
      SET 
        status = 'on_hold',
        freeze_start = $1,
        freeze_end = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
      `,
      [freezeStartStr, freezeEndStr, membership.id]
    );

    let paymentRecord = null;
    if (feeToCharge > 0) {
      const payRes = await client.query(
        `
        INSERT INTO payments (
          member_id,
          membership_id,
          branch_id,
          gym_id,
          amount,
          payment_mode,
          payment_ref,
          payment_date,
          notes,
          status,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, 'completed', $9)
        RETURNING *
        `,
        [
          memberId,
          membership.id,
          memberBranch.branch_id,
          memberBranch.gym_id,
          feeToCharge,
          paymentMode || "Cash",
          paymentRef || null,
          notes || (reason ? `Membership freeze fee: ${reason}` : "Membership freeze fee"),
          req.user.id,
        ]
      );
      paymentRecord = payRes.rows[0];
    }

    try {
      await client.query(
        `
        INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          req.user.id,
          "HOLD_FEES",
          "member_memberships",
          membership.id,
          JSON.stringify({ status: membership.status, end_date: membership.end_date }),
          JSON.stringify({
            status: "on_hold",
            freeze_start: freezeStartStr,
            freeze_end: freezeEndStr,
            projected_end_date: projectedEndDateStr,
            freeze_fee: feeToCharge,
            reason: reason || "Membership paused / on hold",
          }),
        ]
      );
    } catch (auditErr) {
      // Ignore if audit logging fails
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Membership placed on hold for ${daysToHold} day${daysToHold === 1 ? "" : "s"} (until ${freezeEndStr}). Attendance is blocked while frozen. ${feeToCharge > 0 ? `Freeze fee of ₹${feeToCharge} recorded.` : ""}`.trim(),
      data: {
        membership: updateRes.rows[0],
        projectedExpiryDate: projectedEndDateStr,
        freezeStart: freezeStartStr,
        freezeEnd: freezeEndStr,
        daysHeld: daysToHold,
        freezeFee: feeToCharge,
        payment: paymentRecord,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

// ======================================================
// RESUME MEMBER FEES (UNFREEZE MEMBERSHIP)
// ======================================================

const resumeMemberFees = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id: memberId } = req.params;
    const { resumeDate } = req.body;

    // 1. Verify member belongs to tenant gym and branch
    const memberCheck = await client.query(
      `SELECT m.id, m.branch_id, b.gym_id 
       FROM members m 
       JOIN branches b ON b.id = m.branch_id 
       WHERE m.id = $1`,
      [memberId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const memberBranch = memberCheck.rows[0];
    if (req.tenant?.gymId && memberBranch.gym_id !== req.tenant.gymId) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this member's gym",
      });
    }
    if (req.tenant?.branchId && memberBranch.branch_id !== req.tenant.branchId) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this member's branch",
      });
    }

    // 2. Fetch membership currently on hold
    const memRes = await client.query(
      `
      SELECT 
        mm.id, mm.plan_id, mm.start_date, mm.end_date, mm.status,
        mm.freeze_start, mm.freeze_end,
        mp.name as plan_name
      FROM member_memberships mm
      JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.member_id = $1 AND mm.status = 'on_hold'
      ORDER BY mm.end_date DESC
      LIMIT 1
      `,
      [memberId]
    );

    if (memRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No membership currently on hold found for this member.",
      });
    }

    const membership = memRes.rows[0];

    const formatLocalDate = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const actualResumeDate = resumeDate ? new Date(resumeDate) : new Date();
    const freezeStartD = membership.freeze_start ? new Date(membership.freeze_start) : actualResumeDate;

    // Check if resumeDate < freeze_start
    if (actualResumeDate.getTime() < freezeStartD.getTime()) {
      return res.status(400).json({
        success: false,
        message: "Resume date cannot be earlier than the freeze start date.",
      });
    }

    // Calculate actual frozen days
    const diffMs = actualResumeDate.getTime() - freezeStartD.getTime();
    let actualFrozenDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (actualFrozenDays <= 0) {
      actualFrozenDays = 1;
    }

    // On resume, extend end_date by the number of frozen days
    const curEnd = new Date(membership.end_date);
    const newEnd = new Date(curEnd);
    newEnd.setDate(curEnd.getDate() + actualFrozenDays);
    const newEndDateStr = formatLocalDate(newEnd);
    const actualResumeDateStr = formatLocalDate(actualResumeDate);

    await client.query("BEGIN");

    const updateRes = await client.query(
      `
      UPDATE member_memberships
      SET 
        status = CASE WHEN $1::date < CURRENT_DATE THEN 'expired' ELSE 'active' END,
        freeze_end = $2,
        end_date = $1,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
      `,
      [newEndDateStr, actualResumeDateStr, membership.id]
    );

    try {
      await client.query(
        `
        INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          req.user.id,
          "RESUME_FEES",
          "member_memberships",
          membership.id,
          JSON.stringify({ status: membership.status, end_date: membership.end_date }),
          JSON.stringify({
            status: updateRes.rows[0].status,
            end_date: newEndDateStr,
            resumed_at: actualResumeDateStr,
            days_extended: actualFrozenDays,
          }),
        ]
      );
    } catch (auditErr) {
      // Ignore
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Membership resumed successfully. Expiry extended by ${actualFrozenDays} frozen day${actualFrozenDays === 1 ? "" : "s"} to ${newEndDateStr}. Attendance unblocked.`,
      data: {
        membership: updateRes.rows[0],
        newExpiryDate: newEndDateStr,
        frozenDays: actualFrozenDays,
        status: updateRes.rows[0].status,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

module.exports = {
  createMember,
  getMembers,
  exportMembers,
  importMembers,
  holdMemberFees,
  resumeMemberFees,
  getMemberById,
  updateMember,
  deleteMember,
  hardDeleteMember,
  getMemberAchievements,
};