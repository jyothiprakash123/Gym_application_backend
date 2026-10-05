const pool = require("../config/db");

exports.getAchievements = async (req, res) => {
  try {
    const { search = "", page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT a.*, m.full_name as member_name, b.name as branch_name, g.name as gym_name
      FROM achievements a
      LEFT JOIN members m ON a.member_id = m.id
      LEFT JOIN branches b ON m.branch_id = b.id
      LEFT JOIN gyms g ON b.gym_id = g.id
    `;
    let countQuery = `
      SELECT COUNT(*) 
      FROM achievements a
      LEFT JOIN members m ON a.member_id = m.id
      LEFT JOIN branches b ON m.branch_id = b.id
      LEFT JOIN gyms g ON b.gym_id = g.id
    `;
    const params = [];
    const countParams = [];

    if (search) {
      query += ` WHERE a.title ILIKE $1 OR m.full_name ILIKE $1`;
      countQuery += ` WHERE a.title ILIKE $1 OR m.full_name ILIKE $1`;
      params.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }

    query += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [achievementsResult, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams)
    ]);

    const totalItems = parseInt(countResult.rows[0].count);

    res.status(200).json({
      status: "success",
      data: {
        achievements: achievementsResult.rows,
        pagination: {
          totalItems,
          totalPages: Math.ceil(totalItems / limit),
          currentPage: parseInt(page),
          limit: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error("Fetch achievements error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch achievements" });
  }
};

exports.getAchievement = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM achievements WHERE id = $1", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Achievement not found" });
    }
    
    res.status(200).json({ status: "success", data: result.rows[0] });
  } catch (error) {
    console.error("Get achievement error:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch achievement" });
  }
};

exports.createAchievement = async (req, res) => {
  try {
    const { member_id, title, description, date_earned, badge_icon } = req.body;
    
    const result = await pool.query(
      `INSERT INTO achievements (member_id, title, description, date_earned, badge_icon) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [member_id, title, description, date_earned, badge_icon]
    );

    res.status(201).json({ status: "success", data: result.rows[0] });
  } catch (error) {
    console.error("Create achievement error:", error);
    res.status(500).json({ status: "error", message: "Failed to create achievement" });
  }
};

exports.updateAchievement = async (req, res) => {
  try {
    const { id } = req.params;
    const { member_id, title, description, date_earned, badge_icon } = req.body;

    const result = await pool.query(
      `UPDATE achievements 
       SET member_id = $1, title = $2, description = $3, date_earned = $4, badge_icon = $5
       WHERE id = $6 RETURNING *`,
      [member_id, title, description, date_earned, badge_icon, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Achievement not found" });
    }

    res.status(200).json({ status: "success", data: result.rows[0] });
  } catch (error) {
    console.error("Update achievement error:", error);
    res.status(500).json({ status: "error", message: "Failed to update achievement" });
  }
};

exports.deleteAchievement = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM achievements WHERE id = $1 RETURNING *", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Achievement not found" });
    }
    
    res.status(200).json({ status: "success", message: "Achievement deleted successfully" });
  } catch (error) {
    console.error("Delete achievement error:", error);
    res.status(500).json({ status: "error", message: "Failed to delete achievement" });
  }
};
