const pool = require("../config/db");

// ======================================================
// CREATE MESSAGE
// ======================================================

const createMessage = async (req, res, next) => {
  try {
    const {
      gymId,
      branchId,
      title,
      content,
      category = "Closure / Holiday",
      priority = "Normal",
      startDate,
      endDate,
      isActive = true,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message title is required",
      });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message content is required",
      });
    }

    // Determine target gym
    let finalGymId = gymId;
    if (!finalGymId) {
      if (branchId) {
        const bRes = await pool.query("SELECT gym_id FROM branches WHERE id = $1", [branchId]);
        if (bRes.rows.length > 0) {
          finalGymId = bRes.rows[0].gym_id;
        }
      }
    }

    if (!finalGymId && req.user?.gym_id) {
      finalGymId = req.user.gym_id;
    }

    if (!finalGymId) {
      return res.status(400).json({
        success: false,
        message: "Gym is required to create a message",
      });
    }

    // If branchId is empty string, 'all', or null, it's a common gym-wide message
    const finalBranchId = branchId && branchId !== "all" && branchId !== "" ? branchId : null;

    const query = `
      INSERT INTO messages (
        gym_id,
        branch_id,
        title,
        content,
        category,
        priority,
        start_date,
        end_date,
        is_active,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const result = await pool.query(query, [
      finalGymId,
      finalBranchId,
      title.trim(),
      content.trim(),
      category || "Closure / Holiday",
      priority || "Normal",
      startDate || new Date().toISOString().split("T")[0],
      endDate || null,
      isActive !== undefined ? Boolean(isActive) : true,
      req.user?.id || null,
    ]);

    // Fetch message with gym and branch names
    const detailedRes = await pool.query(`
      SELECT 
        m.*,
        b.name AS branch_name,
        g.name AS gym_name,
        u.full_name AS created_by_name
      FROM messages m
      LEFT JOIN branches b ON b.id = m.branch_id
      LEFT JOIN gyms g ON g.id = m.gym_id
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.id = $1
    `, [result.rows[0].id]);

    return res.status(201).json({
      success: true,
      message: "Message created successfully",
      data: {
        message: detailedRes.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ALL MESSAGES
// ======================================================

const getMessages = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = req.query.search ? req.query.search.trim() : "";
    const status = req.query.status || "all";
    const category = req.query.category || "all";
    const priority = req.query.priority || "all";
    const gymId = req.query.gymId || req.user?.gym_id;
    const branchId = req.query.branchId;
    const onlyBranch = req.query.onlyBranch === "true";
    const offset = (page - 1) * limit;

    let baseQuery = `
      FROM messages m
      LEFT JOIN branches b ON b.id = m.branch_id
      LEFT JOIN gyms g ON g.id = m.gym_id
      LEFT JOIN users u ON u.id = m.created_by
    `;

    const conditions = [];
    const params = [];

    // Role-based gym access for gym admins
    if (req.user?.role_name === "admin" && req.user?.gym_id) {
      params.push(req.user.gym_id);
      conditions.push(`m.gym_id = $${params.length}`);
    } else if (gymId) {
      params.push(gymId);
      conditions.push(`m.gym_id = $${params.length}`);
    }

    // Branch filter
    if (branchId && branchId !== "all") {
      if (branchId === "common") {
        conditions.push(`m.branch_id IS NULL`);
      } else if (onlyBranch) {
        params.push(branchId);
        conditions.push(`m.branch_id = $${params.length}`);
      } else {
        // By default, show messages for this branch PLUS common gym-wide messages
        params.push(branchId);
        conditions.push(`(m.branch_id = $${params.length} OR m.branch_id IS NULL)`);
      }
    }

    // Search
    if (search) {
      params.push(`%${search}%`);
      const searchIdx = params.length;
      conditions.push(`(m.title ILIKE $${searchIdx} OR m.content ILIKE $${searchIdx} OR b.name ILIKE $${searchIdx})`);
    }

    // Status filter
    if (status === "active") {
      conditions.push(`m.is_active = true`);
    } else if (status === "inactive") {
      conditions.push(`m.is_active = false`);
    }

    // Category filter
    if (category && category !== "all") {
      params.push(category);
      conditions.push(`m.category = $${params.length}`);
    }

    // Priority filter
    if (priority && priority !== "all") {
      params.push(priority);
      conditions.push(`m.priority = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count query
    const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit) || 1;

    // Sorting
    let sortColumn = "m.created_at";
    if (req.query.sort_by === "title") sortColumn = "m.title";
    else if (req.query.sort_by === "start_date") sortColumn = "m.start_date";
    else if (req.query.sort_by === "priority") sortColumn = "m.priority";
    else if (req.query.sort_by === "is_active") sortColumn = "m.is_active";

    const sortDirection = req.query.sort_dir?.toLowerCase() === "asc" ? "ASC" : "DESC";

    // Data query
    const dataParams = [...params, limit, offset];
    const dataQuery = `
      SELECT 
        m.id,
        m.gym_id,
        m.branch_id,
        m.title,
        m.content,
        m.category,
        m.priority,
        m.start_date,
        m.end_date,
        m.is_active,
        m.created_at,
        m.updated_at,
        b.name AS branch_name,
        g.name AS gym_name,
        u.full_name AS created_by_name
      ${baseQuery}
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `;

    const dataResult = await pool.query(dataQuery, dataParams);

    return res.status(200).json({
      success: true,
      data: {
        messages: dataResult.rows,
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
// GET MESSAGE BY ID
// ======================================================

const getMessageById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        m.*,
        b.name AS branch_name,
        g.name AS gym_name,
        u.full_name AS created_by_name
      FROM messages m
      LEFT JOIN branches b ON b.id = m.branch_id
      LEFT JOIN gyms g ON g.id = m.gym_id
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.id = $1
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        message: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE MESSAGE
// ======================================================

const updateMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      branchId,
      title,
      content,
      category,
      priority,
      startDate,
      endDate,
      isActive,
    } = req.body;

    const checkRes = await pool.query("SELECT * FROM messages WHERE id = $1", [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    const currentMsg = checkRes.rows[0];
    const finalBranchId = branchId !== undefined 
      ? (branchId && branchId !== "all" ? branchId : null) 
      : currentMsg.branch_id;

    const query = `
      UPDATE messages
      SET
        branch_id = $1,
        title = COALESCE($2, title),
        content = COALESCE($3, content),
        category = COALESCE($4, category),
        priority = COALESCE($5, priority),
        start_date = COALESCE($6, start_date),
        end_date = $7,
        is_active = COALESCE($8, is_active),
        updated_at = NOW()
      WHERE id = $9
      RETURNING *
    `;

    const result = await pool.query(query, [
      finalBranchId,
      title !== undefined ? title.trim() : null,
      content !== undefined ? content.trim() : null,
      category || null,
      priority || null,
      startDate || null,
      endDate !== undefined ? (endDate ? endDate : null) : currentMsg.end_date,
      isActive !== undefined ? Boolean(isActive) : null,
      id,
    ]);

    // Fetch updated with relations
    const detailedRes = await pool.query(`
      SELECT 
        m.*,
        b.name AS branch_name,
        g.name AS gym_name,
        u.full_name AS created_by_name
      FROM messages m
      LEFT JOIN branches b ON b.id = m.branch_id
      LEFT JOIN gyms g ON g.id = m.gym_id
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.id = $1
    `, [id]);

    return res.status(200).json({
      success: true,
      message: "Message updated successfully",
      data: {
        message: detailedRes.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// TOGGLE MESSAGE STATUS
// ======================================================

const toggleMessageStatus = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      UPDATE messages
      SET is_active = NOT is_active, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Message status set to ${result.rows[0].is_active ? "Active" : "Inactive"}`,
      data: {
        message: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// DELETE MESSAGE
// ======================================================

const deleteMessage = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await pool.query("DELETE FROM messages WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET RECIPIENTS PREVIEW
// ======================================================

const getRecipientsPreview = async (req, res, next) => {
  try {
    const { id } = req.params;

    const msgRes = await pool.query(`
      SELECT 
        m.*,
        b.name AS branch_name,
        g.name AS gym_name
      FROM messages m
      LEFT JOIN branches b ON b.id = m.branch_id
      LEFT JOIN gyms g ON g.id = m.gym_id
      WHERE m.id = $1
    `, [id]);

    if (msgRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    const message = msgRes.rows[0];

    // Fetch members matching the message branch/gym scope
    let membersQuery = "";
    let membersParams = [];

    if (message.branch_id) {
      membersQuery = `
        SELECT m.id, m.full_name, m.email, m.phone, b.name AS branch_name
        FROM members m
        JOIN branches b ON b.id = m.branch_id
        WHERE m.branch_id = $1 AND m.is_active = true
        ORDER BY m.full_name ASC
      `;
      membersParams = [message.branch_id];
    } else {
      membersQuery = `
        SELECT m.id, m.full_name, m.email, m.phone, b.name AS branch_name
        FROM members m
        JOIN branches b ON b.id = m.branch_id
        WHERE b.gym_id = $1 AND m.is_active = true
        ORDER BY m.full_name ASC
      `;
      membersParams = [message.gym_id];
    }

    const membersRes = await pool.query(membersQuery, membersParams);
    const allActiveMembers = membersRes.rows;

    const membersWithEmail = allActiveMembers.filter(
      (m) => m.email && m.email.trim().length > 0
    );

    const membersWithPhone = allActiveMembers.filter(
      (m) => m.phone && m.phone.trim().length > 0
    );

    return res.status(200).json({
      success: true,
      data: {
        message: {
          id: message.id,
          title: message.title,
          content: message.content,
          category: message.category,
          priority: message.priority,
          gym_name: message.gym_name,
          branch_name: message.branch_name || "All Branches (Common)",
          last_sent_at: message.last_sent_at,
          sent_count: message.sent_count || 0,
        },
        targetAudience: message.branch_name
          ? `Active Members of ${message.branch_name}`
          : `All Active Members of ${message.gym_name || "Gym"} (Common across all branches)`,
        totalActiveMembers: allActiveMembers.length,
        emailRecipientsCount: membersWithEmail.length,
        smsRecipientsCount: membersWithPhone.length,
        sampleRecipients: membersWithEmail.slice(0, 10).map((m) => ({
          id: m.id,
          name: m.full_name,
          email: m.email,
          phone: m.phone,
          branch: m.branch_name,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// SEND MESSAGE TO MEMBERS (VIA SMTP EMAIL)
// ======================================================

const sendMessageToMembers = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { testEmail } = req.body;
    const emailService = require("../services/emailService");

    const msgRes = await pool.query(`
      SELECT 
        m.*,
        b.name AS branch_name,
        g.name AS gym_name
      FROM messages m
      LEFT JOIN branches b ON b.id = m.branch_id
      LEFT JOIN gyms g ON g.id = m.gym_id
      WHERE m.id = $1
    `, [id]);

    if (msgRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    const message = msgRes.rows[0];

    // Fetch active members who have an email
    let membersQuery = "";
    let membersParams = [];

    if (message.branch_id) {
      membersQuery = `
        SELECT m.id, m.full_name, m.email
        FROM members m
        WHERE m.branch_id = $1 AND m.is_active = true AND m.email IS NOT NULL AND TRIM(m.email) != ''
      `;
      membersParams = [message.branch_id];
    } else {
      membersQuery = `
        SELECT m.id, m.full_name, m.email
        FROM members m
        JOIN branches b ON b.id = m.branch_id
        WHERE b.gym_id = $1 AND m.is_active = true AND m.email IS NOT NULL AND TRIM(m.email) != ''
      `;
      membersParams = [message.gym_id];
    }

    const membersRes = await pool.query(membersQuery, membersParams);
    let recipients = membersRes.rows.map((m) => ({
      id: m.id,
      name: m.full_name,
      email: m.email.trim(),
    }));

    if (testEmail && testEmail.trim()) {
      recipients.push({
        id: "test",
        name: "Test Recipient",
        email: testEmail.trim(),
      });
    }

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No active members with email addresses found in this gym / branch.",
      });
    }

    // Send email via emailService (SMTP)
    const emailResult = await emailService.sendBroadcastEmail({
      recipients,
      title: message.title,
      content: message.content,
      category: message.category,
      priority: message.priority,
      gymName: message.gym_name,
      branchName: message.branch_name,
    });

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: emailResult.message || "Failed to send email broadcast",
      });
    }

    // Update message last_sent_at and sent_count
    await pool.query(
      `UPDATE messages 
       SET last_sent_at = NOW(), sent_count = COALESCE(sent_count, 0) + $1, updated_at = NOW() 
       WHERE id = $2`,
      [emailResult.sentCount, id]
    );

    // Log notification in notifications table
    try {
      await pool.query(
        `INSERT INTO notifications (id, gym_id, user_id, title, body, type, status, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'broadcast_email', 'read', NOW())`,
        [
          message.gym_id,
          req.user?.id || null,
          `Broadcast Sent: ${message.title}`,
          `Sent to ${emailResult.sentCount} members via SMTP Email (${message.branch_name || "All Branches"})`,
        ]
      );
    } catch (notifErr) {
      console.warn("Could not log broadcast in notifications table", notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Message broadcast successfully sent to ${emailResult.sentCount} member(s) via Email (SMTP)!`,
      data: {
        sentCount: emailResult.sentCount,
        totalRecipients: recipients.length,
        lastSentAt: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createMessage,
  getMessages,
  getMessageById,
  updateMessage,
  toggleMessageStatus,
  deleteMessage,
  getRecipientsPreview,
  sendMessageToMembers,
};

