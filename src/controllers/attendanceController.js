const pool = require("../config/db");

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

    // Check if member already checked in and not checked out today
    const checkQuery = `
      SELECT id FROM attendance 
      WHERE member_id = $1 
      AND attendance_date = CURRENT_DATE
      AND check_out IS NULL 
      AND check_in IS NOT NULL
    `;
    const checkResult = await pool.query(checkQuery, [memberId]);

    if (checkResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Member is already checked in and hasn't checked out",
      });
    }

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
      ON CONFLICT (member_id, attendance_date) DO UPDATE SET
        branch_id = EXCLUDED.branch_id,
        status = 1,
        check_in = NOW(),
        check_in_method = EXCLUDED.check_in_method,
        marked_by = EXCLUDED.marked_by
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
  } catch (error) {
    next(error);
  }
};

// ======================================================
// BULK MARK ATTENDANCE
// ======================================================

const markBulkAttendance = async (req, res, next) => {
  try {
    const { branchId, attendanceDate, records } = req.body;
    const markedBy = req.user?.id || null;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch is required",
      });
    }

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: "A list of member attendance records is required",
      });
    }

    const dateVal = attendanceDate || new Date().toISOString().slice(0, 10);

    // Format records for postgres jsonb_to_recordset
    const formattedRecords = records.map((r) => {
      const isAbsent = r.status === 0 || r.status === "0";
      return {
        member_id: r.memberId || r.member_id,
        status: isAbsent ? 0 : 1,
        check_in: isAbsent ? null : (r.checkIn || r.check_in || null),
        check_out: isAbsent ? null : (r.checkOut || r.check_out || null),
      };
    });

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
        marked_by = EXCLUDED.marked_by
      RETURNING id, member_id, attendance_date, status, check_in, check_out;
    `;

    const result = await pool.query(query, [
      branchId,
      dateVal,
      markedBy,
      JSON.stringify(formattedRecords),
    ]);

    return res.status(200).json({
      success: true,
      message: `Attendance marked successfully for ${result.rows.length} member(s)`,
      data: {
        count: result.rows.length,
        attendance: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// CHECK OUT MEMBER
// ======================================================

const checkOut = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE attendance
      SET
        check_out = NOW()
      WHERE id = $1 AND check_out IS NULL
      RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found or already checked out",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Checked out successfully",
      data: {
        attendance: result.rows[0],
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

      if (req.user.role_name === "admin") {
        bulkBaseQuery += ` AND b.manager_id = $${countParams.length + 1}`;
        countParams.push(req.user.id);
        dataParams.push(req.user.id);
      } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view attendance",
        });
      }

      if (branchId) {
        bulkBaseQuery += ` AND a.branch_id = $${countParams.length + 1}`;
        countParams.push(branchId);
        dataParams.push(branchId);
      } else if (gymId) {
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

    // Role-based access control
    if (req.user.role_name === "admin") {
      baseQuery += ` AND b.manager_id = $${countParams.length + 1}`;
      countParams.push(req.user.id);
      dataParams.push(req.user.id);
    } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view attendance",
      });
    }

    if (memberId) {
      baseQuery += ` AND a.member_id = $${countParams.length + 1}`;
      countParams.push(memberId);
      dataParams.push(memberId);
    }
    
    if (branchId) {
      baseQuery += ` AND a.branch_id = $${countParams.length + 1}`;
      countParams.push(branchId);
      dataParams.push(branchId);
    } else if (gymId) {
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

    // Check if record exists
    const existing = await pool.query(`SELECT id FROM attendance WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Attendance record not found" });
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

    const result = await pool.query(
      `
      DELETE FROM attendance
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

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

    const result = await pool.query(
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
