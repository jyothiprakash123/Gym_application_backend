const pool = require("../config/db");
const notificationService = require("../services/notificationService");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");
const {
  formatLocalDate,
  getTodayDateStr,
  getNextDayStr,
  calculatePlanEndDate,
} = require("../utils/dateUtils");
const { generateNextInvoiceNumber } = require("../utils/invoiceUtils");

// Standardized allowed payment modes mapping
const ALLOWED_PAYMENT_MODES = {
  cash: "Cash",
  card: "Card",
  "credit card": "Card",
  "debit card": "Card",
  upi: "UPI",
  "bank transfer": "Bank Transfer",
  bank_transfer: "Bank Transfer",
  netbanking: "NetBanking",
  cheque: "Cheque",
  check: "Cheque",
  on_hold: "On Hold",
};

// ======================================================
// CREATE PAYMENT (and assign Membership if planId provided)
// Creates payment and invoice atomically inside the same DB transaction.
// ======================================================
const createPayment = async (req, res, next) => {
  const memberId = req.body.memberId || req.body.member_id;
  const membershipId = req.body.membershipId || req.body.membership_id;
  const planId = req.body.planId || req.body.plan_id;
  const branchId = req.body.branchId || req.body.branch_id;
  const amount = req.body.amount;
  const rawPaymentMode = req.body.paymentMode || req.body.payment_mode;
  const paymentRef = req.body.paymentRef || req.body.payment_ref;
  const notes = req.body.notes;
  const reqStartDate = req.body.startDate || req.body.start_date;
  const isRenewal = Boolean(req.body.isRenewal || req.body.is_renewal);

  if (!memberId || !branchId || amount === undefined || amount === null || amount === "") {
    return res.status(400).json({
      success: false,
      message: "Member ID, Branch ID, and Amount are required",
    });
  }

  // Validate amount: must be positive number (> 0)
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Payment amount must be a positive number greater than 0",
    });
  }

  // Validate payment mode: must match supported modes (Cash, UPI, Card, NetBanking, Cheque, On Hold)
  const modeKey = String(rawPaymentMode || "").trim().toLowerCase();
  if (!rawPaymentMode || !ALLOWED_PAYMENT_MODES[modeKey]) {
    return res.status(400).json({
      success: false,
      message: "Invalid payment mode. Supported modes: Cash, UPI, Card, Bank Transfer, Cheque",
    });
  }
  const normalizedPaymentMode = ALLOWED_PAYMENT_MODES[modeKey];

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // 1. Validate branch ownership
    const branchResult = await client.query(
      `SELECT id, gym_id FROM branches WHERE id = $1`,
      [branchId]
    );

    if (branchResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    const branchGymId = branchResult.rows[0].gym_id;

    if (req.tenant?.gymId && branchGymId !== req.tenant.gymId) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "You do not have access to this branch",
      });
    }

    if (req.tenant?.branchId && req.tenant.branchId !== branchId) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "You do not have access to this branch",
      });
    }

    // Never trust client gymId; enforce tenant gym or branch gym
    const effectiveGymId = req.tenant?.gymId || branchGymId;

    // 2. Validate member ownership
    const memberCheck = await client.query(
      `SELECT m.id, b.gym_id, m.full_name, m.phone 
       FROM members m 
       JOIN branches b ON b.id = m.branch_id 
       WHERE m.id = $1`,
      [memberId]
    );

    if (
      memberCheck.rows.length === 0 ||
      (effectiveGymId && memberCheck.rows[0].gym_id !== effectiveGymId)
    ) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    let actualMembershipId = membershipId;
    let planName = null;

    if (planId) {
      const planResult = await client.query(
        `SELECT mp.id, mp.name, mp.duration_days, b.gym_id 
         FROM membership_plans mp 
         LEFT JOIN branches b ON b.id = mp.branch_id 
         WHERE mp.id = $1`,
        [planId]
      );
      if (
        planResult.rows.length === 0 ||
        (effectiveGymId && planResult.rows[0].gym_id && planResult.rows[0].gym_id !== effectiveGymId)
      ) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "Membership plan not found",
        });
      }

      const plan = planResult.rows[0];
      planName = plan.name;
      const durationDays = plan.duration_days || 30;

      // Check if member already has an active or on-hold membership that has not expired
      const activeMemCheck = await client.query(
        `SELECT id, plan_id, start_date, end_date, status 
         FROM member_memberships 
         WHERE member_id = $1 
           AND status IN ('active', 'on_hold') 
           AND end_date >= CURRENT_DATE 
         ORDER BY end_date DESC 
         LIMIT 1`,
        [memberId]
      );

      // Resolve Start Date
      let startDateStr;
      if (reqStartDate) {
        startDateStr = formatLocalDate(reqStartDate);
      } else if (isRenewal && activeMemCheck.rows.length > 0) {
        const currentActive = activeMemCheck.rows[0];
        startDateStr = getNextDayStr(formatLocalDate(currentActive.end_date));
      } else {
        startDateStr = getTodayDateStr();
      }

      // Prevent assigning a second active plan without using renew
      if (activeMemCheck.rows.length > 0) {
        const currentActive = activeMemCheck.rows[0];
        const currentEndStr = formatLocalDate(currentActive.end_date);

        if (!isRenewal) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: `Member already has an active membership plan (expires on ${currentEndStr}). Use the renewal flow to renew or extend their membership.`,
          });
        }

        if (startDateStr <= currentEndStr) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: `Renewal start date must be after current active plan expiry (${currentEndStr}). Next valid start date is ${getNextDayStr(currentEndStr)}.`,
          });
        }
      }

      // Calculate End Date
      const endDateStr = calculatePlanEndDate(startDateStr, durationDays, plan.name);
      const todayStr = getTodayDateStr();

      let targetStatus;
      if (normalizedPaymentMode === "On Hold") {
        targetStatus = "on_hold";
      } else if (endDateStr >= todayStr) {
        targetStatus = "active";
      } else {
        targetStatus = "expired";
      }

      // Mark prior ended memberships as expired
      await client.query(
        `UPDATE member_memberships 
         SET status = 'expired', updated_at = NOW() 
         WHERE member_id = $1 AND end_date < $2 AND status = 'active'`,
        [memberId, startDateStr]
      );

      // Idempotent membership upsert
      const existingSameMembership = await client.query(
        `SELECT id FROM member_memberships WHERE member_id = $1 AND start_date = $2 AND end_date = $3 LIMIT 1`,
        [memberId, startDateStr, endDateStr]
      );

      if (existingSameMembership.rows.length > 0) {
        actualMembershipId = existingSameMembership.rows[0].id;
        await client.query(
          `UPDATE member_memberships 
           SET plan_id = $1, status = $2, updated_at = NOW() 
           WHERE id = $3`,
          [planId, targetStatus, actualMembershipId]
        );
      } else {
        const membershipResult = await client.query(
          `
          INSERT INTO member_memberships (
            member_id, plan_id, gym_id, branch_id, start_date, end_date, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
          `,
          [memberId, planId, effectiveGymId, branchId, startDateStr, endDateStr, targetStatus]
        );
        actualMembershipId = membershipResult.rows[0].id;
      }

      // Reactivate member if renewal/plan is active
      if (targetStatus === "active") {
        await client.query(
          `UPDATE members SET is_active = true, updated_at = NOW() WHERE id = $1`,
          [memberId]
        );
      }
    } else if (actualMembershipId) {
      // Look up plan name from membershipId if provided
      const memPlanRes = await client.query(
        `SELECT mp.name FROM member_memberships mm JOIN membership_plans mp ON mp.id = mm.plan_id WHERE mm.id = $1`,
        [actualMembershipId]
      );
      if (memPlanRes.rows.length > 0) {
        planName = memPlanRes.rows[0].name;
      }
    }

    if (!planName) {
      planName = req.body.planName || notes || "Gym Fee Payment";
    }

    // 3. Insert Payment record inside transaction
    const paymentResult = await client.query(
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
        created_by,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
      `,
      [
        memberId,
        actualMembershipId || null,
        effectiveGymId,
        branchId,
        numAmount,
        normalizedPaymentMode,
        paymentRef || null,
        notes || null,
        req.user?.id || null,
        normalizedPaymentMode === "On Hold" ? "on_hold" : "completed",
      ]
    );
    const paymentRecord = paymentResult.rows[0];

    // 4. Generate sequential, atomic invoice number (per gym per month)
    const { invoiceNumber } = await generateNextInvoiceNumber(client, effectiveGymId);

    // 5. Insert Invoice record linked to the payment inside same transaction
    const invoiceStatus = normalizedPaymentMode === "On Hold" ? "unpaid" : "paid";
    const invoiceResult = await client.query(
      `
      INSERT INTO invoices (
        invoice_number,
        payment_id,
        gym_id,
        branch_id,
        member_id,
        plan_name,
        amount,
        subtotal,
        total,
        payment_mode,
        status,
        issued_date,
        issued_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_DATE, NOW())
      RETURNING *
      `,
      [
        invoiceNumber,
        paymentRecord.id,
        effectiveGymId,
        branchId,
        memberId,
        planName,
        numAmount,
        numAmount,
        numAmount,
        normalizedPaymentMode,
        invoiceStatus,
      ]
    );
    const invoiceRecord = invoiceResult.rows[0];

    // 6. Commit transaction atomically
    await client.query("COMMIT");

    // Post-commit notification (non-blocking)
    try {
      if (memberCheck.rows[0]?.phone) {
        await notificationService.sendSubscriptionActivated({
          gymId: effectiveGymId,
          memberId,
          phone: memberCheck.rows[0].phone,
          name: memberCheck.rows[0].full_name,
        });
      }
    } catch (notifError) {
      console.error("Failed to send subscription SMS:", notifError);
    }

    return res.status(201).json({
      success: true,
      message: "Payment and invoice recorded successfully",
      data: {
        payment: paymentRecord,
        invoice: invoiceRecord,
      },
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rbError) {
        console.error("Rollback error:", rbError);
      }
    }
    console.error("CREATE PAYMENT ERROR:", error);
    next(error);
  } finally {
    if (client) {
      client.release();
    }
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
    const memberId = req.query.memberId;
    const offset = (page - 1) * limit;

    let baseQuery = `
      FROM payments p
      LEFT JOIN members m ON p.member_id = m.id
      LEFT JOIN branches b ON p.branch_id = b.id
      LEFT JOIN gyms g ON b.gym_id = g.id
      LEFT JOIN member_memberships mm ON p.membership_id = mm.id
      LEFT JOIN membership_plans mp ON mm.plan_id = mp.id
      LEFT JOIN invoices inv ON inv.payment_id = p.id
    `;
    let countParams = [];
    let dataParams = [];
    let conditions = [];

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(req.tenant.gymId);
      dataParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view payments",
      });
    }

    // Shared branch-access helper (Day 2 Prompt 2)
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      conditions.push(`p.branch_id = $${countParams.length + 1}`);
      countParams.push(branchAccess.branchId);
      dataParams.push(branchAccess.branchId);
    }

    if (memberId) {
      conditions.push(`p.member_id = $${countParams.length + 1}`);
      countParams.push(memberId);
      dataParams.push(memberId);
    }

    if (branchId && branchAccess.type !== "BRANCH") {
      conditions.push(`p.branch_id = $${countParams.length + 1}`);
      countParams.push(branchId);
      dataParams.push(branchId);
    } else if (gymId && req.tenant?.isSystemAdmin) {
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
        g.name AS gym_name,
        mp.name AS plan_name,
        mm.start_date,
        mm.end_date,
        inv.id AS invoice_id,
        inv.invoice_number,
        inv.status AS invoice_status
      ${baseQuery}
      ORDER BY p.payment_date DESC, p.created_at DESC
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

    let query = `
      SELECT p.*, m.full_name AS member_name, b.name AS branch_name, b.gym_id, g.name AS gym_name,
             inv.id AS invoice_id, inv.invoice_number, inv.status AS invoice_status
      FROM payments p
      LEFT JOIN members m ON p.member_id = m.id
      LEFT JOIN branches b ON p.branch_id = b.id
      LEFT JOIN gyms g ON b.gym_id = g.id
      LEFT JOIN invoices inv ON inv.payment_id = p.id
      WHERE p.id = $1
    `;
    const params = [id];

    if (req.tenant?.gymId) {
      params.push(req.tenant.gymId);
      query += ` AND b.gym_id = $${params.length}`;
    }

    if (req.tenant?.branchId) {
      params.push(req.tenant.branchId);
      query += ` AND p.branch_id = $${params.length}`;
    }

    query += ` LIMIT 1`;

    const result = await pool.query(query, params);

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

    // Verify payment exists and belongs to tenant gym
    const paymentCheck = await pool.query(
      `SELECT p.id, b.gym_id, p.branch_id 
       FROM payments p 
       JOIN branches b ON b.id = p.branch_id 
       WHERE p.id = $1 LIMIT 1`,
      [id]
    );

    if (
      paymentCheck.rows.length === 0 ||
      (req.tenant?.gymId && paymentCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    if (req.tenant?.branchId && paymentCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this payment" });
    }

    if (amount !== undefined && amount !== null && amount !== "") {
      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount < 0) {
        return res.status(400).json({
          success: false,
          message: "Payment amount cannot be negative",
        });
      }
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

    // Verify payment belongs to tenant gym
    const paymentCheck = await pool.query(
      `SELECT p.id, b.gym_id, p.branch_id 
       FROM payments p 
       JOIN branches b ON b.id = p.branch_id 
       WHERE p.id = $1 LIMIT 1`,
      [id]
    );

    if (
      paymentCheck.rows.length === 0 ||
      (req.tenant?.gymId && paymentCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    if (req.tenant?.branchId && paymentCheck.rows[0].branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this payment" });
    }

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

    // Also cancel associated invoice if present
    await pool.query(
      `UPDATE invoices SET status = 'cancelled' WHERE payment_id = $1`,
      [id]
    );

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

    // Verify payment belongs to tenant gym
    const paymentCheck = await pool.query(
      `SELECT p.id, b.gym_id, p.branch_id 
       FROM payments p 
       JOIN branches b ON b.id = p.branch_id 
       WHERE p.id = $1 LIMIT 1`,
      [id]
    );

    if (
      paymentCheck.rows.length === 0 ||
      (req.tenant?.gymId && paymentCheck.rows[0].gym_id !== req.tenant.gymId)
    ) {
      return res.status(404).json({ success: false, message: "Payment not found" });
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
