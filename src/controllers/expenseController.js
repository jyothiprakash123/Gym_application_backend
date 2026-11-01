const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");

const ALLOWED_EXPENSE_ROLES = ["system-admin", "super-admin", "admin", "accountant"];

// ======================================================
// GET EXPENSES
// ======================================================
exports.getExpenses = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name;
    if (!ALLOWED_EXPENSE_ROLES.includes(userRole)) {
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

    return res.status(200).json({
      success: true,
      data: {
        expenses: result.rows,
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
    console.error("Get Expenses error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ======================================================
// CREATE EXPENSE
// ======================================================
exports.createExpense = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name;
    if (!ALLOWED_EXPENSE_ROLES.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to manage expenses",
      });
    }

    const { branch_id, expense_date, amount, category, description, receipt_url } = req.body;
    const added_by = req.user.id;

    if (!branch_id) {
      return res.status(400).json({ success: false, message: "Branch ID is required" });
    }

    if (amount === undefined || amount === null) {
      return res.status(400).json({ success: false, message: "Amount is required" });
    }

    // Validate branch ownership
    const branchRes = await pool.query(`SELECT id, gym_id FROM branches WHERE id = $1 LIMIT 1`, [branch_id]);
    if (branchRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    if (req.tenant?.gymId && branchRes.rows[0].gym_id !== req.tenant.gymId) {
      return res.status(403).json({ success: false, message: "You do not have access to this branch" });
    }

    if (req.tenant?.branchId && req.tenant.branchId !== branch_id) {
      return res.status(403).json({ success: false, message: "You do not have access to this branch" });
    }

    const result = await pool.query(
      `INSERT INTO expenses (branch_id, expense_date, amount, category, description, receipt_url, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [branch_id, expense_date || new Date(), amount, category, description, receipt_url, added_by]
    );

    return res.status(201).json({
      success: true,
      message: "Expense created successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Create Expense error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ======================================================
// UPDATE EXPENSE
// ======================================================
exports.updateExpense = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name;
    if (!ALLOWED_EXPENSE_ROLES.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to manage expenses",
      });
    }

    const { id } = req.params;
    const { branch_id, expense_date, amount, category, description, receipt_url } = req.body;

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

    if (branch_id) {
      const branchRes = await pool.query(`SELECT id, gym_id FROM branches WHERE id = $1 LIMIT 1`, [branch_id]);
      if (branchRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Branch not found" });
      }
      if (req.tenant?.gymId && branchRes.rows[0].gym_id !== req.tenant.gymId) {
        return res.status(403).json({ success: false, message: "Branch does not belong to your gym" });
      }
    }

    const result = await pool.query(
      `UPDATE expenses 
       SET branch_id = $1, expense_date = $2, amount = $3, category = $4, description = $5, receipt_url = $6
       WHERE id = $7 RETURNING *`,
      [
        branch_id || expense.branch_id,
        expense_date || expense.expense_date,
        amount !== undefined ? amount : expense.amount,
        category || expense.category,
        description || expense.description,
        receipt_url !== undefined ? receipt_url : expense.receipt_url,
        id
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Expense updated successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Update Expense error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ======================================================
// DELETE EXPENSE
// ======================================================
exports.deleteExpense = async (req, res, next) => {
  try {
    const userRole = req.user?.role_name;
    if (!ALLOWED_EXPENSE_ROLES.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to manage expenses",
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
    console.error("Delete Expense error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
