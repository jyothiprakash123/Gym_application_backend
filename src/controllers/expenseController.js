const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");
const { hasPermission } = require("../config/rbacConfig");
const { validateMoney, MAX_MONEY_AMOUNT } = require("../utils/financeUtils");

const ALLOWED_CATEGORIES = ["Rent", "Electricity", "Maintenance", "Salaries", "Other"];

/**
 * Normalizes category input to one of the 5 canonical categories:
 * Rent, Electricity, Maintenance, Salaries, Other
 */
const normalizeCategory = (cat) => {
  if (!cat || typeof cat !== "string") return null;
  const trimmed = cat.trim().toLowerCase();
  if (trimmed === "rent") return "Rent";
  if (trimmed === "electricity" || trimmed === "utilities" || trimmed === "utility") return "Electricity";
  if (trimmed === "maintenance" || trimmed === "repair" || trimmed === "repairs") return "Maintenance";
  if (trimmed === "salaries" || trimmed === "salary" || trimmed === "payroll") return "Salaries";
  if (trimmed === "other" || trimmed === "others" || trimmed === "misc" || trimmed === "miscellaneous" || trimmed === "equipment" || trimmed === "marketing") return "Other";
  return null;
};

// ======================================================
// GET EXPENSES
// ======================================================
const getExpenses = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name || req.user?.role || "";
    if (!hasPermission(userRole, "expenses", "view")) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view expenses",
      });
    }

    const { 
      page = 1, 
      limit = 10, 
      search = "", 
      sortKey = "created_at", 
      sortDirection = "desc",
      gymId = "",
      branchId = ""
    } = req.query;

    const offset = (page - 1) * limit;
    
    let baseQuery = `
      FROM expenses e
      LEFT JOIN branches b ON e.branch_id = b.id
      LEFT JOIN gyms g ON b.gym_id = g.id
      LEFT JOIN users u ON e.added_by = u.id
    `;
    
    const conditions = [];
    const queryParams = [];
    const countParams = [];

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(req.tenant.gymId);
      queryParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view expenses",
      });
    }

    // Shared branch-access helper (Day 2 Prompt 2)
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      conditions.push(`e.branch_id = $${countParams.length + 1}`);
      countParams.push(branchAccess.branchId);
      queryParams.push(branchAccess.branchId);
    }

    // Query filters
    if (branchId && branchAccess.type !== "BRANCH") {
      conditions.push(`e.branch_id = $${countParams.length + 1}`);
      countParams.push(branchId);
      queryParams.push(branchId);
    } else if (gymId && req.tenant?.isSystemAdmin) {
      conditions.push(`b.gym_id = $${countParams.length + 1}`);
      countParams.push(gymId);
      queryParams.push(gymId);
    }

    if (search) {
      conditions.push(`(e.description ILIKE $${countParams.length + 1} OR e.category ILIKE $${countParams.length + 1})`);
      countParams.push(`%${search}%`);
      queryParams.push(`%${search}%`);
    }

    if (conditions.length > 0) {
      baseQuery += ` WHERE ` + conditions.join(" AND ");
    }

    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    
    // Whitelist sort fields to prevent SQL injection
    const validSortKeys = {
      description: "e.description",
      notes: "e.description",
      amount: "e.amount",
      expense_date: "e.expense_date",
      category: "e.category",
      gym_name: "g.name",
      created_at: "e.created_at"
    };
    
    const safeSortKey = validSortKeys[sortKey] || "e.created_at";
    const safeSortDir = sortDirection.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const dataQuery = `
      SELECT e.*, g.name as gym_name, b.name as branch_name, u.full_name as added_by_name
      ${baseQuery}
      ORDER BY ${safeSortKey} ${safeSortDir}
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

    queryParams.push(limit, offset);

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count, 10);
    const result = await pool.query(dataQuery, queryParams);

    // Sum calculation for metrics
    let sumQuery = `SELECT SUM(e.amount) as total_amount ${baseQuery}`;
    const sumResult = await pool.query(sumQuery, countParams);
    const totalAmount = parseFloat(sumResult.rows[0]?.total_amount || 0);

    const formattedExpenses = result.rows.map((row) => ({
      ...row,
      notes: row.description,
      branchId: row.branch_id,
      expenseDate: row.expense_date,
    }));

    return res.status(200).json({
      success: true,
      data: {
        expenses: formattedExpenses,
        metrics: {
          totalAmount
        },
        pagination: {
          totalItems: total,
          total,
          page: parseInt(page, 10),
          currentPage: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalPages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET EXPENSE BY ID
// ======================================================
const getExpenseById = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name || req.user?.role || "";
    if (!hasPermission(userRole, "expenses", "view")) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view expenses",
      });
    }

    const { id } = req.params;
    const result = await pool.query(
      `SELECT e.*, g.name as gym_name, b.name as branch_name, b.gym_id, u.full_name as added_by_name
       FROM expenses e
       JOIN branches b ON b.id = e.branch_id
       LEFT JOIN gyms g ON g.id = b.gym_id
       LEFT JOIN users u ON u.id = e.added_by
       WHERE e.id = $1 LIMIT 1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }

    const expense = result.rows[0];

    // Tenant Gym Isolation
    if (req.tenant?.gymId && expense.gym_id !== req.tenant.gymId) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }

    if (req.tenant?.branchId && expense.branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this expense" });
    }

    return res.status(200).json({
      success: true,
      data: {
        expense: {
          ...expense,
          notes: expense.description,
          branchId: expense.branch_id,
          expenseDate: expense.expense_date,
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// CREATE EXPENSE
// ======================================================
const createExpense = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name || req.user?.role || "";
    if (!hasPermission(userRole, "expenses", "create")) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to manage expenses",
      });
    }

    const targetBranchId = req.body.branch_id || req.body.branchId;
    if (!targetBranchId) {
      return res.status(400).json({ success: false, message: "Branch ID is required" });
    }

    // Validate branch ownership
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

    // Category validation (Rent, Electricity, Maintenance, Salaries, Other)
    const rawCategory = req.body.category;
    const validCategory = normalizeCategory(rawCategory);
    if (!validCategory) {
      return res.status(400).json({
        success: false,
        message: "Valid expense category is required (Rent, Electricity, Maintenance, Salaries, Other)",
      });
    }

    // Amount validation: must be a positive number with at most 2 decimals and sane maximum
    const { amount, receipt_url, receiptUrl } = req.body;
    const moneyCheck = validateMoney(amount, { fieldName: "Amount", allowZero: false });
    if (!moneyCheck.isValid) {
      return res.status(400).json({ success: false, message: moneyCheck.error });
    }
    const numAmount = moneyCheck.parsedAmount;

    // Date validation
    const rawDate = req.body.expense_date || req.body.expenseDate || req.body.date;
    let finalExpenseDate = new Date().toISOString().split('T')[0];
    if (rawDate) {
      const parsedDate = new Date(rawDate);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid expense date",
        });
      }
      finalExpenseDate = typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())
        ? rawDate.trim()
        : parsedDate.toISOString().split('T')[0];
    }

    // Notes / Description
    const rawNotes = req.body.notes !== undefined ? req.body.notes : req.body.description;
    const finalNotes = rawNotes ? String(rawNotes).trim() : "";

    const added_by = req.user.id;

    const result = await pool.query(
      `INSERT INTO expenses (branch_id, expense_date, amount, category, description, receipt_url, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, branch_id, expense_date, amount, category, description, receipt_url, added_by, created_at`,
      [targetBranchId, finalExpenseDate, numAmount, validCategory, finalNotes, receipt_url || receiptUrl || null, added_by]
    );

    const row = result.rows[0];
    return res.status(201).json({
      success: true,
      message: "Expense created successfully",
      data: {
        ...row,
        notes: row.description,
        branchId: row.branch_id,
        expenseDate: row.expense_date,
      }
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE EXPENSE
// ======================================================
const updateExpense = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name || req.user?.role || "";
    if (!hasPermission(userRole, "expenses", "edit")) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to manage expenses",
      });
    }

    const { id } = req.params;
    const { branch_id, branchId, expense_date, expenseDate, date, amount, category, description, notes, receipt_url, receiptUrl } = req.body;

    const existing = await pool.query(
      `SELECT e.*, b.gym_id 
       FROM expenses e 
       JOIN branches b ON b.id = e.branch_id 
       WHERE e.id = $1 LIMIT 1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }

    const expense = existing.rows[0];

    // Tenant Gym Isolation
    if (req.tenant?.gymId && expense.gym_id !== req.tenant.gymId) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }

    if (req.tenant?.branchId && expense.branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this expense" });
    }

    // Branch validation if provided
    const targetBranch = branch_id || branchId;
    if (targetBranch) {
      const branchRes = await pool.query(`SELECT id, gym_id FROM branches WHERE id = $1 LIMIT 1`, [targetBranch]);
      if (branchRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Branch not found" });
      }
      if (req.tenant?.gymId && branchRes.rows[0].gym_id !== req.tenant.gymId) {
        return res.status(403).json({ success: false, message: "Branch does not belong to your gym" });
      }
      if (req.tenant?.branchId && req.tenant.branchId !== targetBranch) {
        return res.status(403).json({ success: false, message: "You do not have access to this branch" });
      }
    }

    // Category validation if provided
    let validCategory = undefined;
    if (category !== undefined) {
      validCategory = normalizeCategory(category);
      if (!validCategory) {
        return res.status(400).json({
          success: false,
          message: "Valid expense category is required (Rent, Electricity, Maintenance, Salaries, Other)",
        });
      }
    }

    // Amount validation if provided
    let numAmount = undefined;
    if (amount !== undefined) {
      const moneyCheck = validateMoney(amount, { fieldName: "Amount", allowZero: false });
      if (!moneyCheck.isValid) {
        return res.status(400).json({
          success: false,
          message: moneyCheck.error,
        });
      }
      numAmount = moneyCheck.parsedAmount;
    }

    // Date validation if provided
    const rawDate = expense_date || expenseDate || date;
    let finalExpenseDate = undefined;
    if (rawDate !== undefined) {
      const parsedDate = new Date(rawDate);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid expense date",
        });
      }
      finalExpenseDate = typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())
        ? rawDate.trim()
        : parsedDate.toISOString().split('T')[0];
    }

    // Notes / Description
    const rawNotes = notes !== undefined ? notes : description;
    const finalNotes = rawNotes !== undefined ? String(rawNotes).trim() : undefined;
    const finalReceipt = receipt_url !== undefined ? receipt_url : (receiptUrl !== undefined ? receiptUrl : undefined);

    const result = await pool.query(
      `UPDATE expenses 
       SET 
         branch_id = COALESCE($1::uuid, branch_id),
         expense_date = COALESCE($2::date, expense_date),
         amount = COALESCE($3::numeric, amount),
         category = COALESCE($4::text, category),
         description = COALESCE($5::text, description),
         receipt_url = COALESCE($6::text, receipt_url)
       WHERE id = $7::uuid 
       RETURNING id, branch_id, expense_date, amount, category, description, receipt_url, added_by, created_at`,
      [
        targetBranch || null,
        finalExpenseDate || null,
        numAmount !== undefined ? numAmount : null,
        validCategory || null,
        finalNotes !== undefined ? finalNotes : null,
        finalReceipt !== undefined ? finalReceipt : null,
        id
      ]
    );

    const updated = result.rows[0];
    return res.status(200).json({
      success: true,
      message: "Expense updated successfully",
      data: {
        ...updated,
        notes: updated.description,
        branchId: updated.branch_id,
        expenseDate: updated.expense_date,
      }
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE EXPENSE
// ======================================================
const deleteExpense = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name || req.user?.role || "";
    if (!hasPermission(userRole, "expenses", "delete")) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete expenses",
      });
    }

    const { id } = req.params;
    
    const existing = await pool.query(
      `SELECT e.*, b.gym_id 
       FROM expenses e 
       JOIN branches b ON b.id = e.branch_id 
       WHERE e.id = $1 LIMIT 1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }

    const expense = existing.rows[0];

    // Tenant Gym Isolation
    if (req.tenant?.gymId && expense.gym_id !== req.tenant.gymId) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }

    if (req.tenant?.branchId && expense.branch_id !== req.tenant.branchId) {
      return res.status(403).json({ success: false, message: "You do not have access to this expense" });
    }

    await pool.query("DELETE FROM expenses WHERE id = $1", [id]);

    return res.status(200).json({
      success: true,
      message: "Expense deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET EXPENSE CATEGORY BREAKDOWN
// ======================================================
const getCategoryBreakdown = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name || req.user?.role || "";
    if (!hasPermission(userRole, "expenses", "view")) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view expenses",
      });
    }

    const { month, year, branchId, branch_id, gymId } = req.query;
    const targetBranchId = branchId || branch_id || "";

    // 1. Resolve date range for the specified month or current month
    let selectedYear;
    let selectedMonth; // 1-12

    if (month && typeof month === "string" && /^\d{4}-\d{2}$/.test(month.trim())) {
      const parts = month.trim().split("-");
      selectedYear = parseInt(parts[0], 10);
      selectedMonth = parseInt(parts[1], 10);
    } else if (month && year) {
      selectedYear = parseInt(year, 10);
      selectedMonth = parseInt(month, 10);
    } else {
      const now = new Date();
      selectedYear = now.getFullYear();
      selectedMonth = now.getMonth() + 1;
    }

    // Format start and end date
    const startMonthStr = String(selectedMonth).padStart(2, "0");
    const startDate = `${selectedYear}-${startMonthStr}-01`;
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
    const endDate = `${selectedYear}-${startMonthStr}-${String(lastDay).padStart(2, "0")}`;

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthLabel = `${monthNames[selectedMonth - 1]} ${selectedYear}`;

    // 2. Build tenant and filter conditions
    const conditions = [];
    const queryParams = [];

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      conditions.push(`b.gym_id = $${queryParams.length + 1}`);
      queryParams.push(req.tenant.gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view expenses",
      });
    }

    // Shared branch-access helper
    const branchAccess = resolveBranchAccess(req);
    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      conditions.push(`e.branch_id = $${queryParams.length + 1}`);
      queryParams.push(branchAccess.branchId);
    } else if (targetBranchId && targetBranchId !== "All Branches" && targetBranchId !== "all") {
      conditions.push(`e.branch_id = $${queryParams.length + 1}`);
      queryParams.push(targetBranchId);
    } else if (gymId && req.tenant?.isSystemAdmin && gymId !== "All Gyms") {
      conditions.push(`b.gym_id = $${queryParams.length + 1}`);
      queryParams.push(gymId);
    }

    // Date range filter
    conditions.push(`e.expense_date >= $${queryParams.length + 1}::date`);
    queryParams.push(startDate);
    conditions.push(`e.expense_date <= $${queryParams.length + 1}::date`);
    queryParams.push(endDate);

    const whereClause = conditions.length > 0 ? `WHERE ` + conditions.join(" AND ") : "";

    const query = `
      SELECT 
        e.category,
        COUNT(*)::int as count,
        COALESCE(SUM(e.amount), 0)::numeric(12, 2) as total_amount
      FROM expenses e
      JOIN branches b ON b.id = e.branch_id
      ${whereClause}
      GROUP BY e.category
      ORDER BY total_amount DESC
    `;

    const result = await pool.query(query, queryParams);

    // Sum overall total amount and count
    let overallTotal = 0;
    let overallCount = 0;
    const categoryMap = new Map();

    result.rows.forEach((row) => {
      const amount = parseFloat(row.total_amount) || 0;
      const count = parseInt(row.count, 10) || 0;
      overallTotal += amount;
      overallCount += count;
      categoryMap.set(row.category, { amount, count });
    });

    // Ensure all 5 canonical categories are present in breakdown
    const breakdown = ALLOWED_CATEGORIES.map((cat) => {
      const data = categoryMap.get(cat) || { amount: 0, count: 0 };
      const percentage = overallTotal > 0 ? Number(((data.amount / overallTotal) * 100).toFixed(2)) : 0;
      return {
        category: cat,
        totalAmount: data.amount,
        count: data.count,
        percentage,
      };
    });

    // Add any legacy non-standard categories if they had expenses
    result.rows.forEach((row) => {
      if (!ALLOWED_CATEGORIES.includes(row.category)) {
        const amount = parseFloat(row.total_amount) || 0;
        const count = parseInt(row.count, 10) || 0;
        const percentage = overallTotal > 0 ? Number(((amount / overallTotal) * 100).toFixed(2)) : 0;
        breakdown.push({
          category: row.category,
          totalAmount: amount,
          count,
          percentage,
        });
      }
    });

    // Sort breakdown by totalAmount descending
    breakdown.sort((a, b) => b.totalAmount - a.totalAmount);

    return res.status(200).json({
      success: true,
      data: {
        period: {
          month: `${selectedYear}-${startMonthStr}`,
          year: selectedYear,
          monthNumber: selectedMonth,
          monthLabel,
          startDate,
          endDate,
        },
        branchId: targetBranchId || null,
        totalAmount: parseFloat(overallTotal.toFixed(2)),
        totalCount: overallCount,
        breakdown,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET NET FINANCIAL SUMMARY (Revenue vs Expenses & Profit/Loss)
// ======================================================
const getNetSummary = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name || req.user?.role || "";
    if (!hasPermission(userRole, "expenses", "view")) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view financial summary",
      });
    }

    const { month, year, branchId, branch_id, gymId } = req.query;
    const requestedBranchId = branchId || branch_id || "";

    // 1. Resolve date range for the specified month or current month
    let selectedYear;
    let selectedMonth; // 1-12

    if (month && typeof month === "string" && /^\d{4}-\d{2}$/.test(month.trim())) {
      const parts = month.trim().split("-");
      selectedYear = parseInt(parts[0], 10);
      selectedMonth = parseInt(parts[1], 10);
    } else if (month && year) {
      selectedYear = parseInt(year, 10);
      selectedMonth = parseInt(month, 10);
    } else {
      const now = new Date();
      selectedYear = now.getFullYear();
      selectedMonth = now.getMonth() + 1;
    }

    // Format start and end date
    const startMonthStr = String(selectedMonth).padStart(2, "0");
    const startDate = `${selectedYear}-${startMonthStr}-01`;
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
    const endDate = `${selectedYear}-${startMonthStr}-${String(lastDay).padStart(2, "0")}`;

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthLabel = `${monthNames[selectedMonth - 1]} ${selectedYear}`;

    // Tenant & Branch Scoping
    const branchAccess = resolveBranchAccess(req);
    let targetBranchId = "";
    let branchName = "All Branches";

    if (branchAccess.type === "BRANCH" && branchAccess.branchId) {
      targetBranchId = branchAccess.branchId;
    } else if (requestedBranchId && requestedBranchId !== "All Branches" && requestedBranchId !== "all") {
      targetBranchId = requestedBranchId;
    }

    // If targetBranchId is specified, check branch existence and gym ownership
    if (targetBranchId) {
      const branchRes = await pool.query(
        `SELECT id, name, gym_id FROM branches WHERE id = $1 LIMIT 1`,
        [targetBranchId]
      );
      if (branchRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Branch not found" });
      }
      if (req.tenant?.gymId && branchRes.rows[0].gym_id !== req.tenant.gymId) {
        return res.status(403).json({ success: false, message: "You do not have access to this branch" });
      }
      branchName = branchRes.rows[0].name;
    }

    // Build conditions for Payments (Revenue)
    const revConditions = [];
    const revParams = [];

    // Tenant Gym Isolation
    if (req.tenant?.gymId) {
      revConditions.push(`b.gym_id = $${revParams.length + 1}`);
      revParams.push(req.tenant.gymId);
    } else if (gymId && req.tenant?.isSystemAdmin && gymId !== "All Gyms") {
      revConditions.push(`b.gym_id = $${revParams.length + 1}`);
      revParams.push(gymId);
    } else if (!req.tenant?.isSystemAdmin) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view financial summary",
      });
    }

    // Branch scoping
    if (targetBranchId) {
      revConditions.push(`p.branch_id = $${revParams.length + 1}`);
      revParams.push(targetBranchId);
    }

    // Date range filter for payments: COALESCE(payment_date, created_at)
    // Completed/Paid payments only
    revConditions.push(`LOWER(COALESCE(p.status, 'completed')) IN ('completed', 'paid')`);
    revConditions.push(`(COALESCE(p.payment_date, p.created_at) AT TIME ZONE 'Asia/Kolkata')::date >= $${revParams.length + 1}::date`);
    revParams.push(startDate);
    revConditions.push(`(COALESCE(p.payment_date, p.created_at) AT TIME ZONE 'Asia/Kolkata')::date <= $${revParams.length + 1}::date`);
    revParams.push(endDate);

    const revWhere = revConditions.length > 0 ? "WHERE " + revConditions.join(" AND ") : "";

    const revenueQuery = `
      SELECT 
        COALESCE(SUM(p.amount), 0)::numeric(12, 2) AS total_revenue,
        COUNT(p.id)::int AS payment_count
      FROM payments p
      JOIN branches b ON b.id = p.branch_id
      ${revWhere}
    `;

    // Build conditions for Expenses
    const expConditions = [];
    const expParams = [];

    if (req.tenant?.gymId) {
      expConditions.push(`b.gym_id = $${expParams.length + 1}`);
      expParams.push(req.tenant.gymId);
    } else if (gymId && req.tenant?.isSystemAdmin && gymId !== "All Gyms") {
      expConditions.push(`b.gym_id = $${expParams.length + 1}`);
      expParams.push(gymId);
    }

    if (targetBranchId) {
      expConditions.push(`e.branch_id = $${expParams.length + 1}`);
      expParams.push(targetBranchId);
    }

    expConditions.push(`e.expense_date >= $${expParams.length + 1}::date`);
    expParams.push(startDate);
    expConditions.push(`e.expense_date <= $${expParams.length + 1}::date`);
    expParams.push(endDate);

    const expWhere = expConditions.length > 0 ? "WHERE " + expConditions.join(" AND ") : "";

    const expensesQuery = `
      SELECT 
        COALESCE(SUM(e.amount), 0)::numeric(12, 2) AS total_expenses,
        COUNT(e.id)::int AS expense_count
      FROM expenses e
      JOIN branches b ON b.id = e.branch_id
      ${expWhere}
    `;

    // Run both queries in parallel
    const [revResult, expResult] = await Promise.all([
      pool.query(revenueQuery, revParams),
      pool.query(expensesQuery, expParams),
    ]);

    const revenue = parseFloat(revResult.rows[0]?.total_revenue || 0);
    const paymentCount = parseInt(revResult.rows[0]?.payment_count || 0, 10);

    const expenses = parseFloat(expResult.rows[0]?.total_expenses || 0);
    const expenseCount = parseInt(expResult.rows[0]?.expense_count || 0, 10);

    const netProfitLoss = parseFloat((revenue - expenses).toFixed(2));
    const isProfit = netProfitLoss >= 0;
    const status = netProfitLoss > 0 ? "profit" : netProfitLoss < 0 ? "loss" : "break-even";

    let profitMargin = 0;
    if (revenue > 0) {
      profitMargin = parseFloat(((netProfitLoss / revenue) * 100).toFixed(2));
    }

    return res.status(200).json({
      success: true,
      data: {
        period: {
          month: `${selectedYear}-${startMonthStr}`,
          year: selectedYear,
          monthNumber: selectedMonth,
          monthLabel,
          startDate,
          endDate,
        },
        branchId: targetBranchId || null,
        branchName,
        revenue,
        expenses,
        netProfitLoss,
        isProfit,
        status,
        profitMargin,
        paymentCount,
        expenseCount,
        metrics: {
          revenue,
          expenses,
          netProfit: isProfit ? netProfitLoss : 0,
          netLoss: !isProfit ? Math.abs(netProfitLoss) : 0,
          netProfitLoss,
          isProfit,
          status,
          profitMargin,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getExpenses,
  getExpenseById,
  getCategoryBreakdown,
  getNetSummary,
  createExpense,
  updateExpense,
  deleteExpense,
  ALLOWED_CATEGORIES,
  normalizeCategory,
  validateMoney,
  MAX_MONEY_AMOUNT,
};
