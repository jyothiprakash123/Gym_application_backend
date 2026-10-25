const pool = require("../config/db");
const notificationService = require("../services/notificationService");

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

    if (!branchId || !fullName || !phone) {
      return res.status(400).json({
        success: false,
        message: "Branch, full name and phone are required",
      });
    }

    const cleanPhone = String(phone).replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 15) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be between 10 and 15 digits",
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

    if (emergencyContactPhone && emergencyContactPhone.trim()) {
      const cleanEmerPhone = String(emergencyContactPhone).replace(/\D/g, "");
      if (cleanEmerPhone.length < 10 || cleanEmerPhone.length > 15) {
        return res.status(400).json({
          success: false,
          message: "Emergency contact phone must be between 10 and 15 digits",
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
        emergencyContactPhone ?? null,
        fullName.trim(),
        email?.trim().toLowerCase() || null,
        phone.trim(),
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

    // Automatically resume memberships whose freeze_end has passed
    try {
      await pool.query(
        "UPDATE member_memberships SET status = 'active', updated_at = NOW() WHERE status = 'on_hold' AND freeze_end < CURRENT_DATE"
      );
    } catch (autoErr) {
      console.error("Auto resume check failed:", autoErr);
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
        mm.status as membership_status,
        mm.freeze_start,
        mm.freeze_end,
        mp.max_freeze_days
      FROM member_memberships mm
      JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.member_id = m.id AND mm.status IN ('active', 'on_hold')
      ORDER BY mm.end_date DESC
      LIMIT 1
    ) active_plan ON true`;
    let countParams = [];
    let dataParams = [];

    let hasWhere = false;

    // Role-based access control
    if (req.user.role_name === "admin") {
      baseQuery += ` WHERE b.manager_id = $1`;
      countParams.push(req.user.id);
      dataParams.push(req.user.id);
      hasWhere = true;
    } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view members",
      });
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
    }

    // Join Date Filter
    if (joinDate === 'last30') {
      baseQuery += hasWhere ? ` AND m.join_date >= NOW() - INTERVAL '30 days'` : ` WHERE m.join_date >= NOW() - INTERVAL '30 days'`;
      hasWhere = true;
    } else if (joinDate === 'thisYear') {
      baseQuery += hasWhere ? ` AND EXTRACT(YEAR FROM m.join_date) = EXTRACT(YEAR FROM NOW())` : ` WHERE EXTRACT(YEAR FROM m.join_date) = EXTRACT(YEAR FROM NOW())`;
      hasWhere = true;
    }
    
    // Gym / Branch Filter
    if (branchId) {
      baseQuery += hasWhere ? ` AND m.branch_id = $${countParams.length + 1}` : ` WHERE m.branch_id = $${countParams.length + 1}`;
      countParams.push(branchId);
      dataParams.push(branchId);
      hasWhere = true;
    } else if (gymId) {
      baseQuery += hasWhere ? ` AND b.gym_id = $${countParams.length + 1}` : ` WHERE b.gym_id = $${countParams.length + 1}`;
      countParams.push(gymId);
      dataParams.push(gymId);
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
        active_plan.max_freeze_days
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
        mm.status as membership_status
      FROM member_memberships mm
      JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.member_id = m.id AND mm.status IN ('active', 'on_hold')
      ORDER BY mm.end_date DESC
      LIMIT 1
    ) active_plan ON true`;
    let dataParams = [];
    let hasWhere = false;

    // Role-based access control
    if (req.user.role_name === "admin") {
      baseQuery += ` WHERE b.manager_id = $1`;
      dataParams.push(req.user.id);
      hasWhere = true;
    } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to export members",
      });
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
    }

    // Join Date Filter
    if (joinDate === 'last30') {
      baseQuery += hasWhere ? ` AND m.join_date >= NOW() - INTERVAL '30 days'` : ` WHERE m.join_date >= NOW() - INTERVAL '30 days'`;
      hasWhere = true;
    } else if (joinDate === 'thisYear') {
      baseQuery += hasWhere ? ` AND EXTRACT(YEAR FROM m.join_date) = EXTRACT(YEAR FROM NOW())` : ` WHERE EXTRACT(YEAR FROM m.join_date) = EXTRACT(YEAR FROM NOW())`;
      hasWhere = true;
    }
    
    // Gym / Branch Filter
    if (branchId) {
      baseQuery += hasWhere ? ` AND m.branch_id = $${dataParams.length + 1}` : ` WHERE m.branch_id = $${dataParams.length + 1}`;
      dataParams.push(branchId);
      hasWhere = true;
    } else if (gymId) {
      baseQuery += hasWhere ? ` AND b.gym_id = $${dataParams.length + 1}` : ` WHERE b.gym_id = $${dataParams.length + 1}`;
      dataParams.push(gymId);
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

    // Role-based branch access validation
    let branchQuery = `SELECT b.id, b.name, b.gym_id, b.is_active FROM branches b`;
    let branchParams = [];

    if (req.user.role_name === "admin") {
      branchQuery += ` WHERE b.manager_id = $1 OR b.id = $2`;
      branchParams.push(req.user.id, req.user.branch_id || req.user.id);
    } else if (req.user.role_name === "super-admin") {
      branchQuery += ` WHERE b.gym_id = $1`;
      branchParams.push(req.user.gym_id);
    } else if (req.user.role_name === "front-desk") {
      branchQuery += ` WHERE b.id = $1`;
      branchParams.push(req.user.branch_id);
    } else if (req.user.role_name !== "system-admin") {
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
      const cleanPhone = String(rawPhone).replace(/\D/g, "");
      const email = (row.email || "").trim().toLowerCase() || null;
      const gender = (row.gender || "").trim() || null;
      const dateOfBirth = parseDateSafe(row.dateOfBirth || row.dob);
      const address = (row.address || "").trim() || null;
      const emergencyContactName = (row.emergencyContactName || "").trim() || null;
      const emergencyContactPhone = row.emergencyContactPhone ? String(row.emergencyContactPhone).replace(/\D/g, "") : null;
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
      if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 15) {
        skipped.push({
          row: rowNum,
          name: fullName,
          phone: rawPhone,
          reason: "Phone number must be between 10 and 15 digits",
        });
        continue;
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

      // Check duplicates within the file batch
      const batchKey = `${targetBranch.id}_${cleanPhone}`;
      if (seenPhonesInBatch.has(batchKey)) {
        skipped.push({
          row: rowNum,
          name: fullName,
          phone: cleanPhone,
          reason: `Duplicate phone number within this import file for branch "${targetBranch.name}"`,
        });
        continue;
      }
      seenPhonesInBatch.add(batchKey);

      // Check duplicate in database for this branch
      const existingMember = await client.query(
        `SELECT id, full_name FROM members WHERE branch_id = $1 AND phone = $2 LIMIT 1`,
        [targetBranch.id, cleanPhone]
      );

      if (existingMember.rows.length > 0) {
        skipped.push({
          row: rowNum,
          name: fullName,
          phone: cleanPhone,
          reason: `Member with phone ${cleanPhone} already exists in ${targetBranch.name} (${existingMember.rows[0].full_name})`,
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
          mm.status as membership_status,
          mm.freeze_start,
          mm.freeze_end,
          mp.max_freeze_days
        FROM member_memberships mm
        JOIN membership_plans mp ON mp.id = mm.plan_id
        WHERE mm.member_id = m.id AND mm.status IN ('active', 'on_hold')
        ORDER BY mm.end_date DESC
        LIMIT 1
      ) active_plan ON true
      WHERE m.id = $1
      LIMIT 1
      `,
      [id]
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

    return res.status(200).json({
      success: true,
      data: {
        member: {
          ...result.rows[0],
          payments: paymentsResult.rows,
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
        id,
        branch_id,
        user_id,
        email
      FROM members
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (memberResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    // --------------------------------------------------
    // Validate new branch if provided
    // --------------------------------------------------

    if (phone !== undefined) {
      const cleanPhone = String(phone).replace(/\D/g, "");
      if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 15) {
        return res.status(400).json({
          success: false,
          message: "Phone number must be between 10 and 15 digits",
        });
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

    if (emergencyContactPhone !== undefined && emergencyContactPhone && emergencyContactPhone.trim()) {
      const cleanEmerPhone = String(emergencyContactPhone).replace(/\D/g, "");
      if (cleanEmerPhone.length < 10 || cleanEmerPhone.length > 15) {
        return res.status(400).json({
          success: false,
          message: "Emergency contact phone must be between 10 and 15 digits",
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
        emergencyContactPhone ?? null,
        fullName?.trim() || null,
        email?.trim().toLowerCase() || null,
        phone?.trim() || null,
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
// EXPORTS
// ======================================================

// ======================================================
// HARD DELETE MEMBER
// ======================================================

const hardDeleteMember = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check permissions
    if (req.user.role_name === "admin") {
      const branchCheck = await pool.query(
        `
        SELECT m.id 
        FROM members m
        JOIN branches b ON b.id = m.branch_id
        WHERE m.id = $1 AND b.manager_id = $2
        `,
        [id, req.user.id]
      );
      if (branchCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to delete this member",
        });
      }
    } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
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
    const { startDate, endDate, durationDays, reason } = req.body;

    // 1. Fetch active membership
    const memRes = await client.query(
      `
      SELECT 
        mm.id, mm.plan_id, mm.start_date, mm.end_date, mm.status,
        mp.name as plan_name, mp.max_freeze_days
      FROM member_memberships mm
      JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.member_id = $1 AND mm.status = 'active'
      ORDER BY mm.end_date DESC
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
      daysToHold = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    } else if (durationDays) {
      daysToHold = parseInt(durationDays, 10);
      endD = new Date(startD);
      endD.setDate(startD.getDate() + daysToHold);
    } else {
      return res.status(400).json({
        success: false,
        message: "Hold end date or duration in days is required.",
      });
    }

    const freezeStartStr = formatLocalDate(startD);
    const freezeEndStr = formatLocalDate(endD);

    // Calculate extended end date: current end_date + daysToHold
    const curEndD = new Date(membership.end_date);
    const newEndD = new Date(curEndD);
    newEndD.setDate(curEndD.getDate() + daysToHold);
    const newEndDateStr = formatLocalDate(newEndD);

    await client.query("BEGIN");

    const updateRes = await client.query(
      `
      UPDATE member_memberships
      SET 
        status = 'on_hold',
        freeze_start = $1,
        freeze_end = $2,
        end_date = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
      `,
      [freezeStartStr, freezeEndStr, newEndDateStr, membership.id]
    );

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
            end_date: newEndDateStr,
            reason: reason || "Membership fees placed on hold",
          }),
        ]
      );
    } catch (auditErr) {
      // Ignore if audit logging fails
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Membership fees placed on hold for ${daysToHold} day${daysToHold === 1 ? "" : "s"} (until ${freezeEndStr}). New expiry is ${newEndDateStr}.`,
      data: {
        membership: updateRes.rows[0],
        newExpiryDate: newEndDateStr,
        freezeStart: freezeStartStr,
        freezeEnd: freezeEndStr,
        daysHeld: daysToHold,
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
    const plannedEndFreeze = membership.freeze_end ? new Date(membership.freeze_end) : actualResumeDate;

    let adjustedEndDateStr = formatLocalDate(new Date(membership.end_date));

    // If resumed early (before planned freeze_end), adjust remaining unconsumed days
    if (actualResumeDate < plannedEndFreeze) {
      const unusedDaysMs = plannedEndFreeze.getTime() - actualResumeDate.getTime();
      const unusedDays = Math.max(0, Math.round(unusedDaysMs / (1000 * 60 * 60 * 24)));
      if (unusedDays > 0) {
        const curEnd = new Date(membership.end_date);
        curEnd.setDate(curEnd.getDate() - unusedDays);
        adjustedEndDateStr = formatLocalDate(curEnd);
      }
    }

    await client.query("BEGIN");

    const updateRes = await client.query(
      `
      UPDATE member_memberships
      SET 
        status = 'active',
        freeze_end = $1,
        end_date = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
      `,
      [formatLocalDate(actualResumeDate), adjustedEndDateStr, membership.id]
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
            status: "active",
            end_date: adjustedEndDateStr,
            resumed_at: formatLocalDate(actualResumeDate),
          }),
        ]
      );
    } catch (auditErr) {
      // Ignore
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Membership fees resumed successfully. Plan is now active with expiry ${adjustedEndDateStr}.`,
      data: {
        membership: updateRes.rows[0],
        newExpiryDate: adjustedEndDateStr,
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