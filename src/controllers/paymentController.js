const pool = require("../config/db");
const notificationService = require("../services/notificationService");

// ======================================================
// CREATE PAYMENT (and assign Membership if planId provided)
// ======================================================
const createPayment = async (req, res, next) => {
  try {
    const { memberId, membershipId, planId, gymId, branchId, amount, paymentMode, paymentRef, notes, startDate: reqStartDate } = req.body;

    if (!memberId || !branchId || amount === undefined) {
      return res.status(400).json({
        success: false,
        message: "Member ID, Branch ID, and Amount are required",
      });
    }

    let actualMembershipId = membershipId;

    if (planId) {
      const planResult = await pool.query('SELECT duration_days FROM membership_plans WHERE id = $1', [planId]);
      if (planResult.rows.length > 0) {
        const durationDays = planResult.rows[0].duration_days || 30;
        let startDate;
        if (reqStartDate) {
          // If reqStartDate is "YYYY-MM-DD", appending "T00:00:00" ensures it's parsed in local timezone
          startDate = new Date(reqStartDate.includes("T") ? reqStartDate : reqStartDate + "T00:00:00");
        } else {
          startDate = new Date();
        }
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + durationDays);

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        // Check if this member already has a membership starting on this date, or ending on this date
        // to prevent duplicate renewals or edits from creating new records.
        const existingMembership = await pool.query(
          `SELECT id FROM member_memberships WHERE member_id = $1 AND (start_date::date = $2 OR end_date::date = $3)`,
          [memberId, startDateStr, endDateStr]
        );

        if (existingMembership.rows.length > 0) {
          actualMembershipId = existingMembership.rows[0].id;

          // Update the membership with the new plan and end date
          await pool.query(
            `UPDATE member_memberships SET plan_id = $1, start_date = $2, end_date = $3 WHERE id = $4`,
            [planId, startDate, endDate, actualMembershipId]
          );

          // Check if there is an existing payment for this membership
          const existingPayment = await pool.query(
            `SELECT id FROM payments WHERE member_id = $1 AND membership_id = $2`,
            [memberId, actualMembershipId]
          );

          if (existingPayment.rows.length > 0) {
             // Update the existing payment
             const updatedPaymentResult = await pool.query(
               `
               UPDATE payments
               SET
                 amount = $1,
                 payment_mode = $2,
                 payment_ref = $3,
                 notes = $4
               WHERE id = $5
               RETURNING *
               `,
               [amount, paymentMode || null, paymentRef || null, notes || null, existingPayment.rows[0].id]
             );
             
             return res.status(200).json({
               success: true,
               message: "Payment updated successfully",
               data: { payment: updatedPaymentResult.rows[0] },
             });
          }
        } else {
          // If no membership matches the dates, check if a payment was literally just made TODAY for this member
          // and if so, we assume they are editing it, so we find its membership and update both
          const paymentToday = await pool.query(
            `SELECT p.id as payment_id, p.membership_id 
             FROM payments p 
             WHERE p.member_id = $1 AND p.created_at::date = CURRENT_DATE 
             LIMIT 1`,
            [memberId]
          );
          
          if (paymentToday.rows.length > 0 && paymentToday.rows[0].membership_id) {
            actualMembershipId = paymentToday.rows[0].membership_id;
            
            // Update membership
            await pool.query(
              `UPDATE member_memberships SET plan_id = $1, start_date = $2, end_date = $3 WHERE id = $4`,
              [planId, startDate, endDate, actualMembershipId]
            );
            
            // Update payment
            const updatedPaymentResult = await pool.query(
               `
               UPDATE payments
               SET
                 amount = $1,
                 payment_mode = $2,
                 payment_ref = $3,
                 notes = $4
               WHERE id = $5
               RETURNING *
               `,
               [amount, paymentMode || null, paymentRef || null, notes || null, paymentToday.rows[0].payment_id]
             );
             
             return res.status(200).json({
               success: true,
               message: "Payment updated successfully",
               data: { payment: updatedPaymentResult.rows[0] },
             });
          }
          
          const membershipResult = await pool.query(
            `
            INSERT INTO member_memberships (
              member_id, plan_id, gym_id, branch_id, start_date, end_date, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
            `,
            [memberId, planId, gymId || null, branchId, startDate, endDate, 'active']
          );
          actualMembershipId = membershipResult.rows[0].id;
        }
      }
    }

    const result = await pool.query(
      `
      INSERT INTO payments (
        member_id,
        membership_id,
        gym_id,
        branch_id,
        amount,
        payment_mode,
        payment_ref,
        notes,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [
        memberId,
        actualMembershipId || null,
        gymId || null,
        branchId,
        amount,
        paymentMode || null,
        paymentRef || null,
        notes || null,
        req.user.id
      ]
    );

    // Trigger Notification Service
    try {
      const memberInfo = await pool.query('SELECT full_name, phone FROM members WHERE id = $1', [memberId]);
      if (memberInfo.rows.length > 0) {
        let finalGymId = gymId;
        if (!finalGymId) {
          const branchGym = await pool.query('SELECT gym_id FROM branches WHERE id = $1', [branchId]);
          finalGymId = branchGym.rows[0]?.gym_id;
        }
        await notificationService.sendSubscriptionActivated({
          gymId: finalGymId,
          memberId,
          phone: memberInfo.rows[0].phone,
          name: memberInfo.rows[0].full_name
        });
      }
    } catch (notifError) {
      console.error("Failed to send subscription SMS:", notifError);
    }

    return res.status(201).json({
      success: true,
      message: "Payment recorded successfully",
      data: { payment: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ALL PAYMENTS
// ======================================================
const getPayments = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const branchId = req.query.branchId;
    const gymId = req.query.gymId;
    const offset = (page - 1) * limit;

    let baseQuery = `
      FROM payments p
      LEFT JOIN members m ON p.member_id = m.id
      LEFT JOIN branches b ON p.branch_id = b.id
      LEFT JOIN gyms g ON b.gym_id = g.id
    `;
    let countParams = [];
    let dataParams = [];
    let conditions = [];

    // Role-based access control (similar to plans)
    if (req.user.role_name === "admin") {
      conditions.push(`b.manager_id = $${countParams.length + 1}`);
      countParams.push(req.user.id);
      dataParams.push(req.user.id);
    } else if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view payments",
      });
    }

    if (branchId) {
      conditions.push(`p.branch_id = $${countParams.length + 1}`);
      countParams.push(branchId);
      dataParams.push(branchId);
    } else if (gymId) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(gymId);
      dataParams.push(gymId);
    }

    if (search) {
      const searchStr = `%${search}%`;
      conditions.push(`(m.full_name ILIKE $${countParams.length + 1} OR p.payment_ref ILIKE $${countParams.length + 1})`);
      countParams.push(searchStr);
      dataParams.push(searchStr);
    }

    if (conditions.length > 0) {
      baseQuery += ` WHERE ` + conditions.join(" AND ");
    }

    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await pool.query(countQuery, countParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);

    dataParams.push(limit, offset);
    const limitOffsetCondition = ` LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;

    const dataQuery = `
      SELECT 
        p.*,
        m.full_name AS member_name,
        b.name AS branch_name,
        g.name AS gym_name
      ${baseQuery}
      ORDER BY p.created_at DESC
      ${limitOffsetCondition}
    `;

    const result = await pool.query(dataQuery, dataParams);

    return res.status(200).json({
      success: true,
      data: {
        payments: result.rows,
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
// GET PAYMENT BY ID
// ======================================================
const getPaymentById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT p.*, m.full_name AS member_name, b.name AS branch_name, b.gym_id, g.name AS gym_name
      FROM payments p
      LEFT JOIN members m ON p.member_id = m.id
      LEFT JOIN branches b ON p.branch_id = b.id
      LEFT JOIN gyms g ON b.gym_id = g.id
      WHERE p.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: { payment: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE PAYMENT
// ======================================================
const updatePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, paymentMode, paymentRef, status, notes } = req.body;

    const paymentResult = await pool.query(`SELECT id FROM payments WHERE id = $1 LIMIT 1`, [id]);
    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    const result = await pool.query(
      `
      UPDATE payments
      SET
        amount = COALESCE($1::numeric, amount),
        payment_mode = COALESCE($2::character varying, payment_mode),
        payment_ref = COALESCE($3::character varying, payment_ref),
        status = COALESCE($4::character varying, status),
        notes = COALESCE($5::text, notes)
      WHERE id = $6::uuid
      RETURNING *
      `,
      [
        amount ?? null,
        paymentMode ?? null,
        paymentRef ?? null,
        status ?? null,
        notes ?? null,
        id,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Payment updated successfully",
      data: { payment: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE PAYMENT (Soft Delete / Update Status)
// ======================================================
const deletePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
      UPDATE payments
      SET status = 'cancelled'
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Payment cancelled successfully",
      data: { payment: result.rows[0] },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// HARD DELETE PAYMENT
// ======================================================
const hardDeletePayment = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.role_name !== "system-admin" && req.user.role_name !== "super-admin") {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete payments",
      });
    }

    const result = await pool.query(
      `DELETE FROM payments WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Payment deleted permanently",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createPayment,
  getPayments,
  getPaymentById,
  updatePayment,
  deletePayment,
  hardDeletePayment,
};
