const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");

// ======================================================
// GET ALL INVOICES (with filters, pagination & tenant isolation)
// ======================================================
const getInvoices = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const search = req.query.search || "";
    const branchId = req.query.branchId || req.query.branch_id;
    const gymId = req.query.gymId || req.query.gym_id;
    const memberId = req.query.memberId || req.query.member_id;
    const paymentMode = req.query.paymentMode || req.query.payment_mode;
    const status = req.query.status;
    const startDate = req.query.startDate || req.query.start_date;
    const endDate = req.query.endDate || req.query.end_date;

    let baseQuery = `
      FROM invoices inv
      LEFT JOIN members m ON inv.member_id = m.id
      LEFT JOIN branches b ON inv.branch_id = b.id
      LEFT JOIN gyms g ON inv.gym_id = g.id
      LEFT JOIN payments p ON inv.payment_id = p.id
      LEFT JOIN member_memberships mm ON p.membership_id = mm.id
    `;

    let countParams = [];
    let dataParams = [];
    let conditions = [];

    // 1. Tenant Gym Isolation (Day 1 rule)
    if (req.tenant?.gymId) {
      conditions.push(`inv.gym_id = $${countParams.length + 1}`);
      countParams.push(req.tenant.gymId);
      dataParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view invoices",
      });
    } else if (gymId && gymId !== "all") {
      // System admin can filter by gymId
      conditions.push(`inv.gym_id = $${countParams.length + 1}`);
      countParams.push(gymId);
      dataParams.push(gymId);
    }

    // 2. Branch Access Helper (Day 2 rule)
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      conditions.push(`(inv.branch_id = $${countParams.length + 1} OR inv.branch_id IS NULL)`);
      countParams.push(branchAccess.branchId);
      dataParams.push(branchAccess.branchId);
    } else if (branchId && branchId !== "all") {
      conditions.push(`inv.branch_id = $${countParams.length + 1}`);
      countParams.push(branchId);
      dataParams.push(branchId);
    }

    // 3. Search Filter (invoice number, member name, phone, email)
    if (search && search.trim() !== "") {
      const searchStr = `%${search.trim()}%`;
      conditions.push(
        `(inv.invoice_number ILIKE $${countParams.length + 1} OR m.full_name ILIKE $${countParams.length + 1} OR m.phone ILIKE $${countParams.length + 1} OR m.email ILIKE $${countParams.length + 1})`
      );
      countParams.push(searchStr);
      dataParams.push(searchStr);
    }

    // 4. Member Filter
    if (memberId) {
      conditions.push(`inv.member_id = $${countParams.length + 1}`);
      countParams.push(memberId);
      dataParams.push(memberId);
    }

    // 5. Payment Mode Filter
    if (paymentMode && paymentMode !== "all") {
      conditions.push(`inv.payment_mode ILIKE $${countParams.length + 1}`);
      countParams.push(paymentMode);
      dataParams.push(paymentMode);
    }

    // 6. Status Filter
    if (status && status !== "all") {
      conditions.push(`inv.status ILIKE $${countParams.length + 1}`);
      countParams.push(status);
      dataParams.push(status);
    }

    // 7. Date Range Filters
    if (startDate) {
      conditions.push(`(inv.issued_date >= $${countParams.length + 1} OR DATE(inv.issued_at) >= $${countParams.length + 1})`);
      countParams.push(startDate);
      dataParams.push(startDate);
    }
    if (endDate) {
      conditions.push(`(inv.issued_date <= $${countParams.length + 1} OR DATE(inv.issued_at) <= $${countParams.length + 1})`);
      countParams.push(endDate);
      dataParams.push(endDate);
    }

    if (conditions.length > 0) {
      baseQuery += ` WHERE ` + conditions.join(" AND ");
    }

    // Count Total Items
    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await pool.query(countQuery, countParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit) || 1;

    // Fetch Paginated Records
    dataParams.push(limit, offset);
    const limitOffsetCondition = ` LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;

    const dataQuery = `
      SELECT 
        inv.*,
        m.full_name AS member_name,
        m.phone AS member_phone,
        m.email AS member_email,
        b.name AS branch_name,
        b.address AS branch_address,
        b.phone AS branch_phone,
        g.name AS gym_name,
        g.logo_url AS gym_logo,
        g.email AS gym_email,
        g.phone AS gym_phone,
        g.city AS gym_city,
        g.state AS gym_state,
        p.payment_ref,
        p.payment_date,
        p.notes AS payment_notes,
        mm.start_date AS membership_start_date,
        mm.end_date AS membership_end_date
      ${baseQuery}
      ORDER BY inv.issued_at DESC, inv.created_at DESC
      ${limitOffsetCondition}
    `;

    const result = await pool.query(dataQuery, dataParams);

    return res.status(200).json({
      success: true,
      data: {
        invoices: result.rows,
        pagination: {
          totalItems,
          total: totalItems,
          page,
          currentPage: page,
          limit,
          totalPages,
        },
      },
    });
  } catch (error) {
    console.error("GET INVOICES ERROR:", error);
    next(error);
  }
};

// ======================================================
// GET INVOICE BY ID or INVOICE NUMBER
// ======================================================
const getInvoiceById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    let query = `
      SELECT 
        inv.*,
        m.full_name AS member_name,
        m.phone AS member_phone,
        m.email AS member_email,
        b.name AS branch_name,
        b.address AS branch_address,
        b.phone AS branch_phone,
        g.name AS gym_name,
        g.logo_url AS gym_logo,
        g.email AS gym_email,
        g.phone AS gym_phone,
        g.city AS gym_city,
        g.state AS gym_state,
        p.payment_ref,
        p.payment_date,
        p.notes AS payment_notes,
        mm.start_date AS membership_start_date,
        mm.end_date AS membership_end_date
      FROM invoices inv
      LEFT JOIN members m ON inv.member_id = m.id
      LEFT JOIN branches b ON inv.branch_id = b.id
      LEFT JOIN gyms g ON inv.gym_id = g.id
      LEFT JOIN payments p ON inv.payment_id = p.id
      LEFT JOIN member_memberships mm ON p.membership_id = mm.id
      WHERE ${isUuid ? "inv.id = $1::uuid" : "inv.invoice_number = $1"}
    `;
    const params = [id];

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      params.push(req.tenant.gymId);
      query += ` AND inv.gym_id = $${params.length}`;
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view invoices",
      });
    }

    // Branch Access restriction
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      params.push(branchAccess.branchId);
      query += ` AND (inv.branch_id = $${params.length} OR inv.branch_id IS NULL)`;
    }

    query += ` LIMIT 1`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: { invoice: result.rows[0] },
    });
  } catch (error) {
    console.error("GET INVOICE BY ID ERROR:", error);
    next(error);
  }
};

// ======================================================
// GET INVOICE BY PAYMENT ID
// ======================================================
const getInvoiceByPaymentId = async (req, res, next) => {
  try {
    const { paymentId } = req.params;

    let query = `
      SELECT 
        inv.*,
        m.full_name AS member_name,
        m.phone AS member_phone,
        m.email AS member_email,
        b.name AS branch_name,
        b.address AS branch_address,
        b.phone AS branch_phone,
        g.name AS gym_name,
        g.logo_url AS gym_logo,
        g.email AS gym_email,
        g.phone AS gym_phone,
        g.city AS gym_city,
        g.state AS gym_state,
        p.payment_ref,
        p.payment_date,
        p.notes AS payment_notes,
        mm.start_date AS membership_start_date,
        mm.end_date AS membership_end_date
      FROM invoices inv
      LEFT JOIN members m ON inv.member_id = m.id
      LEFT JOIN branches b ON inv.branch_id = b.id
      LEFT JOIN gyms g ON inv.gym_id = g.id
      LEFT JOIN payments p ON inv.payment_id = p.id
      LEFT JOIN member_memberships mm ON p.membership_id = mm.id
      WHERE inv.payment_id = $1::uuid
    `;
    const params = [paymentId];

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      params.push(req.tenant.gymId);
      query += ` AND inv.gym_id = $${params.length}`;
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view invoices",
      });
    }

    // Branch Access restriction
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      params.push(branchAccess.branchId);
      query += ` AND (inv.branch_id = $${params.length} OR inv.branch_id IS NULL)`;
    }

    query += ` LIMIT 1`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invoice for this payment not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: { invoice: result.rows[0] },
    });
  } catch (error) {
    console.error("GET INVOICE BY PAYMENT ID ERROR:", error);
    next(error);
  }
};

module.exports = {
  getInvoices,
  getInvoiceById,
  getInvoiceByPaymentId,
};
