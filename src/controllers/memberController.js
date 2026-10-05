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

    let baseQuery = `FROM members m 
    LEFT JOIN branches b ON b.id = m.branch_id 
    LEFT JOIN gyms g ON g.id = b.gym_id
    LEFT JOIN LATERAL (
      SELECT mp.name as plan_name, mm.end_date as expiry_date, mm.plan_id
      FROM member_memberships mm
      JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.member_id = m.id AND mm.status = 'active'
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
        active_plan.plan_id
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
      SELECT mp.name as plan_name, mm.end_date as expiry_date, mm.plan_id
      FROM member_memberships mm
      JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.member_id = m.id AND mm.status = 'active'
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
        active_plan.expiry_date
      ${baseQuery}
      ORDER BY m.created_at DESC
    `;

    const result = await pool.query(dataQuery, dataParams);
    const members = result.rows;

    const headers = ["Sno", "Name", "Email", "Phone", "Plan", "Expiry", "Gym", "Branch", "Status"];
    const csvRows = [headers.join(",")];

    members.forEach((m, index) => {
      const row = [
        index + 1,
        `"${m.full_name || ''}"`,
        `"${m.email || ''}"`,
        `"${m.phone || ''}"`,
        `"${m.plan_name || 'No plan'}"`,
        `"${m.expiry_date ? new Date(m.expiry_date).toLocaleDateString() : ''}"`,
        `"${m.gym_name || ''}"`,
        `"${m.branch_name || ''}"`,
        m.is_active ? "Active" : "Inactive"
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
        active_plan.plan_id
      FROM members m
      LEFT JOIN branches b
        ON b.id = m.branch_id
      LEFT JOIN gyms g
        ON g.id = b.gym_id
      LEFT JOIN LATERAL (
        SELECT mp.name as plan_name, mm.end_date as expiry_date, mm.plan_id
        FROM member_memberships mm
        JOIN membership_plans mp ON mp.id = mm.plan_id
        WHERE mm.member_id = m.id AND mm.status = 'active'
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

    return res.status(200).json({
      success: true,
      data: {
        member: result.rows[0],
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

module.exports = {
  createMember,
  getMembers,
  exportMembers,
  getMemberById,
  updateMember,
  deleteMember,
  hardDeleteMember,
  getMemberAchievements,
};