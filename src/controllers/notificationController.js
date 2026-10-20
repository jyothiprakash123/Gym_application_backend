const pool = require("../config/db");

// Helper function to dynamically generate notifications for expiring members within 5 days
const generateExpiringNotifications = async (userId, gymId) => {
  try {
    // 1. Clear existing expiring_membership notifications for this user so relative days count is always fresh & dynamic
    await pool.query(
      `DELETE FROM notifications WHERE user_id = $1 AND type = 'expiring_membership'`,
      [userId]
    );

    // 2. Insert members whose active membership expires in the next 5 days (CURRENT_DATE to CURRENT_DATE + 5)
    const query = `
      INSERT INTO notifications (id, gym_id, user_id, member_id, channel, status, type, title, body, created_at)
      SELECT 
        gen_random_uuid(),
        COALESCE(mm.gym_id, b.gym_id),
        $1,
        m.id,
        'in_app',
        'unread',
        'expiring_membership',
        m.full_name,
        COALESCE(mp.name, 'Plan') || ' expires on ' || to_char(mm.end_date, 'DD/MM/YYYY') || 
          CASE 
            WHEN (mm.end_date - CURRENT_DATE) = 0 THEN ' (Expires today)'
            WHEN (mm.end_date - CURRENT_DATE) = 1 THEN ' (Expires tomorrow)'
            WHEN (mm.end_date - CURRENT_DATE) > 1 THEN ' (in ' || (mm.end_date - CURRENT_DATE) || ' days)'
            ELSE ''
          END,
        NOW()
      FROM member_memberships mm
      JOIN members m ON m.id = mm.member_id
      JOIN branches b ON b.id = m.branch_id
      LEFT JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE mm.status = 'active'
        AND m.is_active = true
        AND ($2::uuid IS NULL OR b.gym_id = $2::uuid OR mm.gym_id = $2::uuid)
        AND mm.end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + 5)
    `;
    await pool.query(query, [userId, gymId || null]);
  } catch (error) {
    console.error("Failed to generate expiring notifications", error);
  }
};

const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const gymId = req.query.gymId || req.user.gym_id || null;
    const limit = parseInt(req.query.limit) || 100;
    
    // Lazily generate expiring notifications
    await generateExpiringNotifications(userId, gymId);

    const result = await pool.query(
      `SELECT * FROM notifications 
       WHERE (user_id = $1 OR type IN ('MEMBER_ADDED', 'SUBSCRIPTION_ADDED'))
         AND ($2::uuid IS NULL OR gym_id = $2::uuid OR gym_id IS NULL)
       ORDER BY created_at DESC 
       LIMIT $3`,
      [userId, gymId, limit]
    );

    res.status(200).json({
      success: true,
      data: {
        notifications: result.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

const refreshNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const gymId = req.query.gymId || req.body.gymId || req.user.gym_id || null;
    const limit = parseInt(req.query.limit || req.body.limit) || 100;

    // Force regenerate expiring notifications for next 5 days
    await generateExpiringNotifications(userId, gymId);

    const result = await pool.query(
      `SELECT * FROM notifications 
       WHERE (user_id = $1 OR type IN ('MEMBER_ADDED', 'SUBSCRIPTION_ADDED'))
         AND ($2::uuid IS NULL OR gym_id = $2::uuid OR gym_id IS NULL)
       ORDER BY created_at DESC 
       LIMIT $3`,
      [userId, gymId, limit]
    );

    res.status(200).json({
      success: true,
      message: "Notifications refreshed successfully",
      data: {
        notifications: result.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const result = await pool.query(
      `UPDATE notifications 
       SET status = 'read' 
       WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)
       RETURNING *`,
      [id, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.status(200).json({
      success: true,
      data: { notification: result.rows[0] }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNotifications,
  refreshNotifications,
  markAsRead
};
