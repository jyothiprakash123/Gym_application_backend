const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");
const { formatLocalDate, getTodayDateStr } = require("../utils/dateUtils");

// ======================================================
// CHECK IN MEMBER
// ======================================================

const checkIn = async (req, res, next) => {
  try {
    const { memberId, branchId, checkInMethod } = req.body;
    const markedBy = req.user.id;

    if (!memberId || !branchId) {
      return res.status(400).json({
        success: false,
        message: "Member and Branch are required",
      });
    }

    // 1. Validate branch ownership
    const branchResult = await pool.query(
      `SELECT id, gym_id, is_active FROM branches WHERE id = $1 LIMIT 1`,
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
        message: "Cannot check in to an inactive branch",
      });
    }

    const effectiveGymId = req.tenant?.gymId || branchGymId;

    // 2. Validate member ownership and active account status
    const memberCheck = await pool.query(
      `SELECT m.id, m.full_name, m.is_active, b.gym_id, m.branch_id 
       FROM members m 
       JOIN branches b ON b.id = m.branch_id 
       WHERE m.id = $1 LIMIT 1`,
      [memberId]
    );

    if (
      memberCheck.rows.length === 0 ||
      (effectiveGymId && memberCheck.rows[0].gym_id !== effectiveGymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    if (req.tenant?.branchId && memberCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this member",
      });
    }

    if (memberCheck.rows[0].is_active === false) {
      return res.status(400).json({
        success: false,
        message: "Attendance blocked: Member account is currently inactive.",
      });
    }

    // 3. Validate membership status: attendance is blocked while frozen or expired
    const memCheck = await pool.query(
      `
      SELECT 
        mm.id, mm.status, mm.end_date, mm.freeze_start, mm.freeze_end, p.name as plan_name
      FROM member_memberships mm
      LEFT JOIN membership_plans p ON p.id = mm.plan_id
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

    if (memCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Attendance blocked: Member does not have any membership plan assigned. Please assign a plan before check-in.",
      });
    }

    const currentMem = memCheck.rows[0];
    if (currentMem.status === "on_hold") {
      const freezeInfo = (currentMem.freeze_start && currentMem.freeze_end)
        ? ` (held from ${formatLocalDate(currentMem.freeze_start)} to ${formatLocalDate(currentMem.freeze_end)})`
        : "";
      return res.status(400).json({
        success: false,
        message: `Attendance blocked: Member's membership is currently on hold (frozen)${freezeInfo}. Please resume membership before check-in.`,
      });
    }

    const todayStr = getTodayDateStr();
    const memEndStr = formatLocalDate(currentMem.end_date);
    if (currentMem.status === "expired" || (memEndStr && memEndStr < todayStr)) {
      return res.status(400).json({
        success: false,
        message: `Attendance blocked: Member's membership expired on ${memEndStr || "previous date"}. Please renew membership before check-in.`,
      });
    }

    if (currentMem.status !== "active") {
      return res.status(400).json({
        success: false,
        message: `Attendance blocked: Member's membership status is '${currentMem.status}'. Active membership required for check-in.`,
      });
    }

    // 4. Duplicate check-in validation (block duplicate check-in for same member and date)
    const existingCheck = await pool.query(
      `SELECT id, status, check_in, check_out 
       FROM attendance 
       WHERE member_id = $1 AND attendance_date = CURRENT_DATE 
       LIMIT 1`,
      [memberId]
    );

    if (existingCheck.rows.length > 0) {
      const existing = existingCheck.rows[0];
      if (existing.status === 1) {
        if (existing.check_out) {
          return res.status(400).json({
            success: false,
            message: "Member has already checked in and completed their session for today.",
          });
        }
        return res.status(400).json({
          success: false,
          message: "Member is already checked in today and has not checked out yet.",
        });
      }

      // If record exists with status = 0 (e.g. absent from bulk roll-call earlier), update to present
      const updatedRecord = await pool.query(
        `UPDATE attendance 
         SET status = 1, check_in = NOW(), check_in_method = $1, marked_by = $2, branch_id = $3
         WHERE id = $4
         RETURNING *`,
        [checkInMethod || "manual", markedBy, branchId, existing.id]
      );

      return res.status(200).json({
        success: true,
        message: "Checked in successfully",
        data: {
          attendance: updatedRecord.rows[0],
        },
      });
    }

    // 5. Insert new attendance record using unique constraint protection
    try {
      const result = await pool.query(
        `
        INSERT INTO attendance (
          branch_id,
          member_id,
          attendance_date,
          status,
          check_in,
          check_in_method,
          marked_by
        )
        VALUES (
          $1, $2, CURRENT_DATE, 1, NOW(), $3, $4
        )
        RETURNING *
        `,
        [branchId, memberId, checkInMethod || "manual", markedBy]
      );

      return res.status(201).json({
        success: true,
        message: "Checked in successfully",
        data: {
          attendance: result.rows[0],
        },
      });
    } catch (insertErr) {
      if (insertErr.code === "23505") {
        return res.status(400).json({
          success: false,
          message: "Member has already checked in for today.",
        });
      }
      throw insertErr;
    }
  } catch (error) {
    next(error);
  }
};

// ======================================================
// BULK MARK ATTENDANCE
// ======================================================

const markBulkAttendance = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { branchId, attendanceDate, records } = req.body;
    const markedBy = req.user?.id || null;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch is required",
      });
    }

    // 1. Validate branch ownership and active status
    const branchResult = await client.query(
      `SELECT id, gym_id, is_active FROM branches WHERE id = $1 LIMIT 1`,
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
        message: "Cannot mark attendance in an inactive branch",
      });
    }

    const effectiveGymId = req.tenant?.gymId || branchGymId;

    // 2. Validate records array
    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: "A list of member attendance records is required",
      });
    }

    // 3. Validate Date (not in the future)
    const todayStr = getTodayDateStr();
    const dateVal = formatLocalDate(attendanceDate) || todayStr;

    if (!dateVal || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      return res.status(400).json({
        success: false,
        message: "Valid attendance date (YYYY-MM-DD) is required",
      });
    }

    if (dateVal > todayStr) {
      return res.status(400).json({
        success: false,
        message: "Attendance date cannot be in the future",
      });
    }

    // 4. Validate that EVERY member belongs to the user's branch & gym
    const memberIds = records.map((r) => r.memberId || r.member_id).filter(Boolean);
    if (memberIds.length === 0 || memberIds.length !== records.length) {
      return res.status(400).json({
        success: false,
        message: "All records must contain a valid memberId",
      });
    }

    const memberRowsResult = await client.query(
      `SELECT m.id, m.full_name, m.branch_id, m.is_active, b.gym_id
       FROM members m
       JOIN branches b ON b.id = m.branch_id
       WHERE m.id = ANY($1::uuid[])`,
      [memberIds]
    );

    const foundMembers = memberRowsResult.rows;
    if (foundMembers.length !== memberIds.length) {
      return res.status(404).json({
        success: false,
        message: "One or more members were not found in the database",
      });
    }

    for (const m of foundMembers) {
      if (effectiveGymId && m.gym_id !== effectiveGymId) {
        return res.status(403).json({
          success: false,
          message: `Security violation: Member ${m.full_name} does not belong to your gym`,
        });
      }
      if (m.branch_id !== branchId) {
        return res.status(400).json({
          success: false,
          message: `Member ${m.full_name} does not belong to the selected branch`,
        });
      }
    }

    // Format records for postgres jsonb_to_recordset
    const formattedRecords = records.map((r) => {
      const isAbsent = r.status === 0 || r.status === "0";
      return {
        member_id: r.memberId || r.member_id,
        status: isAbsent ? 0 : 1,
        check_in: isAbsent
          ? null
          : (r.checkIn || r.check_in || (dateVal === todayStr ? new Date().toISOString() : `${dateVal}T09:00:00.000Z`)),
        check_out: isAbsent ? null : (r.checkOut || r.check_out || null),
      };
    });

    // 5. If any member being marked present (status = 1) is currently frozen or expired on dateVal, block
    const presentMemberIds = formattedRecords
      .filter((r) => r.status === 1)
      .map((r) => r.member_id);

    if (presentMemberIds.length > 0) {
      const frozenCheck = await client.query(
        `SELECT mm.member_id, m.full_name
         FROM member_memberships mm
         JOIN members m ON m.id = mm.member_id
         WHERE mm.member_id = ANY($1::uuid[]) 
           AND (
             mm.status = 'on_hold' 
             OR (mm.freeze_start IS NOT NULL AND mm.freeze_end IS NOT NULL AND $2::date >= mm.freeze_start AND $2::date <= mm.freeze_end)
           )`,
        [presentMemberIds, dateVal]
      );

      if (frozenCheck.rows.length > 0) {
        const frozenNames = frozenCheck.rows.map((r) => r.full_name || r.member_id).join(", ");
        return res.status(400).json({
          success: false,
          message: `Attendance blocked: Cannot check in frozen member(s): ${frozenNames}. Please resume membership before marking attendance.`,
        });
      }

      // Check expired members or members without active plan on dateVal
      const membershipCheck = await client.query(
        `SELECT m.id AS member_id, m.full_name,
           (SELECT mm.status FROM member_memberships mm 
            WHERE mm.member_id = m.id 
            ORDER BY 
              CASE WHEN mm.status = 'active' AND mm.end_date >= $2::date THEN 1 ELSE 2 END ASC,
              mm.end_date DESC LIMIT 1) as active_status,
           (SELECT mm.end_date FROM member_memberships mm 
            WHERE mm.member_id = m.id 
            ORDER BY mm.end_date DESC LIMIT 1) as end_date
         FROM members m
         WHERE m.id = ANY($1::uuid[])`,
        [presentMemberIds, dateVal]
      );

      const expiredMembers = membershipCheck.rows.filter(
        (r) => !r.active_status || r.active_status !== 'active' || (r.end_date && formatLocalDate(r.end_date) < dateVal)
      );

      if (expiredMembers.length > 0) {
        const expiredNames = expiredMembers
          .map((r) => `${r.full_name} (${r.end_date ? 'expired ' + formatLocalDate(r.end_date) : 'no plan'})`)
          .join(", ");
        return res.status(400).json({
          success: false,
          message: `Attendance blocked: Cannot mark present for expired member(s): ${expiredNames}. Please renew membership.`,
        });
      }
    }

    // 6. Execute bulk upsert in ONE database transaction
    await client.query("BEGIN");

    const query = `
      INSERT INTO attendance (
        branch_id,
        member_id,
        attendance_date,
        status,
        check_in,
        check_out,
        check_in_method,
        marked_by
      )
      SELECT 
        $1::uuid,
        m.member_id,
        $2::date,
        m.status,
        m.check_in,
        m.check_out,
        'bulk',
        $3::uuid
      FROM jsonb_to_recordset($4::jsonb) AS m(
        member_id uuid,
        status smallint,
        check_in timestamptz,
        check_out timestamptz
      )
      ON CONFLICT (member_id, attendance_date) DO UPDATE SET
        branch_id = EXCLUDED.branch_id,
        status = EXCLUDED.status,
        check_in = EXCLUDED.check_in,
        check_out = EXCLUDED.check_out,
        check_in_method = 'bulk',
        marked_by = EXCLUDED.marked_by
      RETURNING id, member_id, attendance_date, status, check_in, check_out;
    `;

    const result = await client.query(query, [
      branchId,
      dateVal,
      markedBy,
      JSON.stringify(formattedRecords),
    ]);

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Attendance marked successfully for ${result.rows.length} member(s)`,
      data: {
        count: result.rows.length,
        attendanceDate: dateVal,
        attendance: result.rows,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

// ======================================================
// CHECK OUT MEMBER
// ======================================================

const checkOut = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { memberId } = req.body || {};

    let targetAttendanceId = id;

    // If ID is not in params, or if memberId is passed, locate today's attendance record
    if (!targetAttendanceId && memberId) {
      const todayRecord = await pool.query(
        `SELECT a.id FROM attendance a 
         WHERE a.member_id = $1 AND a.attendance_date = CURRENT_DATE AND a.status = 1
         ORDER BY a.created_at DESC LIMIT 1`,
        [memberId]
      );
      if (todayRecord.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No active check-in found for this member today.",
        });
      }
      targetAttendanceId = todayRecord.rows[0].id;
    }

    if (!targetAttendanceId) {
      return res.status(400).json({
        success: false,
        message: "Attendance ID or Member ID is required for check-out",
      });
    }

    // Check attendance existence and tenant ownership
    const attCheck = await pool.query(
      `SELECT a.id, a.member_id, a.branch_id, a.attendance_date, a.status, a.check_in, a.check_out, b.gym_id, m.full_name
       FROM attendance a 
       JOIN branches b ON b.id = a.branch_id 
       LEFT JOIN members m ON m.id = a.member_id
       WHERE a.id = $1 LIMIT 1`,
      [targetAttendanceId]
    );

    if (
      attCheck.rows.length === 0 ||
      (req.tenant?.gymId && attCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    if (req.tenant?.branchId && attCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this attendance record",
      });
    }

    const currentRecord = attCheck.rows[0];

    if (currentRecord.status === 0 || !currentRecord.check_in) {
      return res.status(400).json({
        success: false,
        message: "Cannot check out: Member was not checked in today.",
      });
    }

    if (currentRecord.check_out) {
      const checkoutTime = new Date(currentRecord.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return res.status(400).json({
        success: false,
        message: `Member has already checked out today at ${checkoutTime}.`,
      });
    }

    const result = await pool.query(
      `
      UPDATE attendance
      SET
        check_out = NOW()
      WHERE id = $1 AND check_out IS NULL
      RETURNING *
      `,
      [targetAttendanceId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Member already checked out",
      });
    }

    const row = result.rows[0];
    const durationMinutes = (row.check_in && row.check_out)
      ? Math.max(0, Math.round((new Date(row.check_out) - new Date(row.check_in)) / 60000))
      : null;

    return res.status(200).json({
      success: true,
      message: "Checked out successfully",
      data: {
        attendance: row,
        durationMinutes,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ATTENDANCE
// ======================================================

const getAttendance = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const memberId = req.query.memberId || null;
    const branchId = req.query.branchId || null;
    const gymId = req.query.gymId || null;
    const date = req.query.date || req.query.attendanceDate || null;
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;
    const status = req.query.status !== undefined && req.query.status !== "" ? req.query.status : null;
    const isBulkView = req.query.view === "bulk";
    const offset = (page - 1) * limit;

    // 1. Grouped / Bulk View Mode
    if (isBulkView) {
      let bulkBaseQuery = `
        FROM attendance a 
        JOIN branches b ON b.id = a.branch_id
        LEFT JOIN gyms g ON g.id = b.gym_id
        WHERE 1=1
      `;
      let countParams = [];
      let dataParams = [];

      // Tenant Gym Isolation
      if (req.tenant?.gymId) {
        bulkBaseQuery += ` AND b.gym_id = $${countParams.length + 1}`;
        countParams.push(req.tenant.gymId);
        dataParams.push(req.tenant.gymId);
      } else if (!req.tenant?.isSystemAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view attendance",
        });
      }

      // Shared branch-access helper (Day 2 Prompt 2)
      const branchAccess = resolveBranchAccess(req);
      if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
        bulkBaseQuery += ` AND a.branch_id = $${countParams.length + 1}`;
        countParams.push(branchAccess.branchId);
        dataParams.push(branchAccess.branchId);
      }

      if (branchId && branchAccess.type !== "BRANCH") {
        bulkBaseQuery += ` AND a.branch_id = $${countParams.length + 1}`;
        countParams.push(branchId);
        dataParams.push(branchId);
      } else if (gymId && req.tenant?.isSystemAdmin) {
        bulkBaseQuery += ` AND b.gym_id = $${countParams.length + 1}`;
        countParams.push(gymId);
        dataParams.push(gymId);
      }

      if (startDate && endDate) {
        bulkBaseQuery += ` AND a.attendance_date BETWEEN $${countParams.length + 1} AND $${countParams.length + 2}`;
        countParams.push(startDate, endDate);
        dataParams.push(startDate, endDate);
      } else if (startDate) {
        bulkBaseQuery += ` AND a.attendance_date >= $${countParams.length + 1}`;
        countParams.push(startDate);
        dataParams.push(startDate);
      } else if (endDate) {
        bulkBaseQuery += ` AND a.attendance_date <= $${countParams.length + 1}`;
        countParams.push(endDate);
        dataParams.push(endDate);
      } else if (date) {
        bulkBaseQuery += ` AND a.attendance_date = $${countParams.length + 1}`;
        countParams.push(date);
        dataParams.push(date);
      }

      if (search) {
        const searchStr = `%${search}%`;
        const searchCondition = `(b.name ILIKE $${countParams.length + 1} OR g.name ILIKE $${countParams.length + 1})`;
        bulkBaseQuery += ` AND ${searchCondition}`;
        countParams.push(searchStr);
        dataParams.push(searchStr);
      }

      const countQuery = `
        SELECT COUNT(*) FROM (
          SELECT a.branch_id, a.attendance_date
          ${bulkBaseQuery}
          GROUP BY a.branch_id, a.attendance_date
        ) sub
      `;
      const countResult = await pool.query(countQuery, countParams);
      const totalItems = parseInt(countResult.rows[0].count, 10);
      const totalPages = Math.ceil(totalItems / limit);

      dataParams.push(limit, offset);
      const limitOffsetCondition = ` LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;

      const dataQuery = `
        SELECT
          a.branch_id,
          b.name AS branch_name,
          g.name AS gym_name,
          TO_CHAR(a.attendance_date, 'YYYY-MM-DD') AS attendance_date,
          COUNT(a.id)::int AS total_count,
          COUNT(CASE WHEN a.status = 1 THEN 1 END)::int AS present_count,
          COUNT(CASE WHEN a.status = 0 THEN 1 END)::int AS absent_count,
          MAX(a.created_at) AS created_at
        ${bulkBaseQuery}
        GROUP BY a.branch_id, b.name, g.name, a.attendance_date
        ORDER BY a.attendance_date DESC, MAX(a.created_at) DESC
        ${limitOffsetCondition}
      `;

      const result = await pool.query(dataQuery, dataParams);

      return res.status(200).json({
        success: true,
        data: {
          attendance: result.rows,
          pagination: {
            totalItems,
            totalPages,
            currentPage: page,
            limit,
          },
        },
      });
    }

    // 2. Standard Member-level View Mode
    let baseQuery = `
      FROM attendance a 
      JOIN members m ON m.id = a.member_id 
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN gyms g ON g.id = b.gym_id
      LEFT JOIN users u ON u.id = a.marked_by
      WHERE 1=1
    `;
    let countParams = [];
    let dataParams = [];

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      baseQuery += ` AND b.gym_id = $${countParams.length + 1}`;
      countParams.push(req.tenant.gymId);
      dataParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view attendance",
      });
    }

    // Shared branch-access helper (Day 2 Prompt 2)
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      baseQuery += ` AND a.branch_id = $${countParams.length + 1}`;
      countParams.push(branchAccess.branchId);
      dataParams.push(branchAccess.branchId);
    }

    if (memberId) {
      baseQuery += ` AND a.member_id = $${countParams.length + 1}`;
      countParams.push(memberId);
      dataParams.push(memberId);
    }
    
    if (branchId && branchAccess.type !== "BRANCH") {
      baseQuery += ` AND a.branch_id = $${countParams.length + 1}`;
      countParams.push(branchId);
      dataParams.push(branchId);
    } else if (gymId && req.tenant?.isSystemAdmin) {
      baseQuery += ` AND b.gym_id = $${countParams.length + 1}`;
      countParams.push(gymId);
      dataParams.push(gymId);
    }

    if (startDate && endDate) {
      baseQuery += ` AND a.attendance_date BETWEEN $${countParams.length + 1} AND $${countParams.length + 2}`;
      countParams.push(startDate, endDate);
      dataParams.push(startDate, endDate);
    } else if (startDate) {
      baseQuery += ` AND a.attendance_date >= $${countParams.length + 1}`;
      countParams.push(startDate);
      dataParams.push(startDate);
    } else if (endDate) {
      baseQuery += ` AND a.attendance_date <= $${countParams.length + 1}`;
      countParams.push(endDate);
      dataParams.push(endDate);
    } else if (date) {
      baseQuery += ` AND a.attendance_date = $${countParams.length + 1}`;
      countParams.push(date);
      dataParams.push(date);
    }

    if (status !== null) {
      baseQuery += ` AND a.status = $${countParams.length + 1}`;
      countParams.push(parseInt(status, 10));
      dataParams.push(parseInt(status, 10));
    }

    // Search Condition
    if (search) {
      const searchStr = `%${search}%`;
      const searchCondition = `(m.full_name ILIKE $${countParams.length + 1} OR m.email ILIKE $${countParams.length + 1} OR m.phone ILIKE $${countParams.length + 1})`;
      baseQuery += ` AND ${searchCondition}`;
      countParams.push(searchStr);
      dataParams.push(searchStr);
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
        a.id,
        a.branch_id,
        b.name AS branch_name,
        g.name AS gym_name,
        a.member_id,
        m.full_name AS member_name,
        m.email AS member_email,
        m.phone AS member_phone,
        TO_CHAR(a.attendance_date, 'YYYY-MM-DD') AS attendance_date,
        a.status,
        a.check_in,
        a.check_out,
        a.check_in_method,
        a.marked_by,
        u.full_name AS marked_by_name,
        a.created_at
      ${baseQuery}
      ORDER BY a.attendance_date DESC, a.check_in DESC NULLS LAST, a.created_at DESC
      ${limitOffsetCondition}
    `;

    const result = await pool.query(dataQuery, dataParams);

    return res.status(200).json({
      success: true,
      data: {
        attendance: result.rows,
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
// UPDATE ATTENDANCE
// ======================================================

const updateAttendance = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { checkIn, checkOut, branchId, memberId, checkInMethod, attendanceDate, status } = req.body;

    // Check attendance existence and tenant ownership
    const attCheck = await pool.query(
      `SELECT a.id, b.gym_id, a.branch_id 
       FROM attendance a 
       JOIN branches b ON b.id = a.branch_id 
       WHERE a.id = $1 LIMIT 1`,
      [id]
    );

    if (
      attCheck.rows.length === 0 ||
      (req.tenant?.gymId && attCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({ success: false, message: "Attendance record not found" });
    }

    if (req.tenant?.branchId && attCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this attendance record" });
    }

    if (branchId) {
      const branchRes = await pool.query(`SELECT id, gym_id FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
      if (branchRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Branch not found" });
      }
      if (req.tenant?.gymId && branchRes.rows[0].gym_id !== req.tenant.gymId) {
        return res.status(403).json({ success: false, message: "Branch does not belong to your gym" });
      }
    }

    if (memberId) {
      const memberRes = await pool.query(
        `SELECT m.id, b.gym_id FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id = $1 LIMIT 1`,
        [memberId]
      );
      if (memberRes.rows.length === 0 || (req.tenant?.gymId && memberRes.rows[0].gym_id !== req.tenant.gymId)) {
        return res.status(404).json({ success: false, message: "Member not found" });
      }
    }

    const result = await pool.query(
      `
      UPDATE attendance
      SET
        check_in = $1::timestamptz,
        check_out = $2::timestamptz,
        branch_id = COALESCE($3::uuid, branch_id),
        member_id = COALESCE($4::uuid, member_id),
        check_in_method = COALESCE($5::varchar, check_in_method),
        attendance_date = COALESCE($6::date, attendance_date),
        status = COALESCE($7::smallint, status)
      WHERE id = $8
      RETURNING *
      `,
      [
        checkIn || null,
        checkOut || null,
        branchId || null,
        memberId || null,
        checkInMethod || null,
        attendanceDate || null,
        status !== undefined ? status : null,
        id
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Attendance updated successfully",
      data: {
        attendance: result.rows[0]
      }
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE ATTENDANCE (SINGLE)
// ======================================================

const deleteAttendance = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check attendance existence and tenant ownership
    const attCheck = await pool.query(
      `SELECT a.id, b.gym_id, a.branch_id 
       FROM attendance a 
       JOIN branches b ON b.id = a.branch_id 
       WHERE a.id = $1 LIMIT 1`,
      [id]
    );

    if (
      attCheck.rows.length === 0 ||
      (req.tenant?.gymId && attCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    if (req.tenant?.branchId && attCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this attendance record",
      });
    }

    await pool.query(
      `
      DELETE FROM attendance
      WHERE id = $1
      `,
      [id]
    );

    return res.status(200).json({
      success: true,
      message: "Attendance record deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE BULK ATTENDANCE (BY BRANCH & DATE)
// ======================================================

const deleteBulkAttendance = async (req, res, next) => {
  try {
    const { branchId, date } = req.query;

    if (!branchId || !date) {
      return res.status(400).json({
        success: false,
        message: "Branch and date are required to delete bulk attendance records",
      });
    }

    // Verify branch ownership
    const branchRes = await pool.query(`SELECT id, gym_id FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
    if (branchRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    if (req.tenant?.gymId && branchRes.rows[0].gym_id !== req.tenant.gymId) {
      return res.status(403).json({ success: false, message: "You do not have access to this branch" });
    }

    if (req.tenant?.branchId && req.tenant.branchId !== branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this branch" });
    }

    await pool.query(
      `
      DELETE FROM attendance
      WHERE branch_id = $1 AND attendance_date = $2::date
      `,
      [branchId, date]
    );

    return res.status(200).json({
      success: true,
      message: `Deleted attendance records for ${date}`,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  checkIn,
  markBulkAttendance,
  checkOut,
  getAttendance,
  updateAttendance,
  deleteAttendance,
  deleteBulkAttendance,
};
