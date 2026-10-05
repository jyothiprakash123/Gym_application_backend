const pool = require("../config/db");

// Get all expenses (with pagination, search, sort, and role-based filtering)
exports.getExpenses = async (req, res) => {
  try {
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

    // Role-based filtering
    if (req.user.role_name === "admin") {
      conditions.push(`g.id = $${countParams.length + 1}`);
      countParams.push(req.user.gym_id);
      queryParams.push(req.user.gym_id);
    } else if (["trainer", "front-desk", "accountant"].includes(req.user.role_name)) {
      conditions.push(`e.branch_id = $${countParams.length + 1}`);
      countParams.push(req.user.branch_id);
      queryParams.push(req.user.branch_id);
    }

    // Explicit query filters from UI (for super-admin and admin)
    if (gymId) {
      conditions.push(`g.id = $${countParams.length + 1}`);
      countParams.push(gymId);
      queryParams.push(gymId);
    }
    if (branchId) {
      conditions.push(`e.branch_id = $${countParams.length + 1}`);
      countParams.push(branchId);
      queryParams.push(branchId);
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
    let sumQuery = `SELECT SUM(amount) as total_amount ${baseQuery}`;
    const sumResult = await pool.query(sumQuery, countParams);
    const totalAmount = parseFloat(sumResult.rows[0].total_amount || 0);

    return res.status(200).json({
      success: true,
      data: {
        expenses: result.rows,
        metrics: {
          totalAmount
        },
        pagination: {
          totalItems: total,
          page: parseInt(page, 10),
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

// Create Expense
exports.createExpense = async (req, res) => {
  try {
    const { branch_id, expense_date, amount, category, description, receipt_url } = req.body;
    const added_by = req.user.id;

    // Validate branch_id
    if (!branch_id) {
      return res.status(400).json({ success: false, message: "Branch ID is required" });
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

// Update Expense
exports.updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { branch_id, expense_date, amount, category, description, receipt_url } = req.body;

    const existing = await pool.query("SELECT * FROM expenses WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Expense not found" });
    }

    const result = await pool.query(
      `UPDATE expenses 
       SET branch_id = $1, expense_date = $2, amount = $3, category = $4, description = $5, receipt_url = $6
       WHERE id = $7 RETURNING *`,
      [
        branch_id || existing.rows[0].branch_id,
        expense_date || existing.rows[0].expense_date,
        amount !== undefined ? amount : existing.rows[0].amount,
        category || existing.rows[0].category,
        description || existing.rows[0].description,
        receipt_url !== undefined ? receipt_url : existing.rows[0].receipt_url,
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

// Delete Expense
exports.deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    
    const existing = await pool.query("SELECT * FROM expenses WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Expense not found" });
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
