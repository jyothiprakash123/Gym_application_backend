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
      AND check_out IS NULL 
      AND DATE(check_in AT TIME ZONE 'UTC') = CURRENT_DATE
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
        check_in,
        check_in_method,
        marked_by
      )
      VALUES (
        $1, $2, NOW(), $3, $4
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
    const offset = (page - 1) * limit;

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

    // Search Condition
    if (search) {
      const searchStr = `%${search}%`;
      const searchCondition = `(m.full_name ILIKE $${countParams.length + 1} OR m.email ILIKE $${countParams.length + 1})`;
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
        a.check_in,
        a.check_out,
        a.check_in_method,
        a.marked_by,
        u.full_name AS marked_by_name,
        a.created_at
      ${baseQuery}
      ORDER BY a.check_in DESC
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
    const { checkIn, checkOut, branchId, memberId, checkInMethod } = req.body;

    // Check if record exists
    const existing = await pool.query(`SELECT id FROM attendance WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Attendance record not found" });
    }

    const result = await pool.query(
      `
      UPDATE attendance
      SET
        check_in = COALESCE($1::timestamptz, check_in),
        check_out = $2::timestamptz,
        branch_id = COALESCE($3::uuid, branch_id),
        member_id = COALESCE($4::uuid, member_id),
        check_in_method = COALESCE($5::varchar, check_in_method)
      WHERE id = $6
      RETURNING *
      `,
      [checkIn || null, checkOut || null, branchId || null, memberId || null, checkInMethod || null, id]
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
// DELETE ATTENDANCE
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

module.exports = {
  checkIn,
  checkOut,
  getAttendance,
  updateAttendance,
  deleteAttendance,
};
