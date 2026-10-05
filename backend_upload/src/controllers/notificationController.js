const pool = require("../config/db");

// Helper function to lazily generate notifications for expiring members
const generateExpiringNotifications = async (userId) => {
  try {
    // Find members whose active membership expires in the next 7 days
    const query = `
      INSERT INTO notifications (id, gym_id, user_id, member_id, status, type, title, body, created_at)
      SELECT 
        gen_random_uuid(),
        b.gym_id,
        $1,
        m.id,
        'unread',
        'expiring_membership',
        'Membership Expiring',
        m.full_name || '''s plan expires on ' || to_char(mm.end_date, 'MM/DD/YYYY'),
        NOW()
      FROM member_memberships mm
      JOIN members m ON m.id = mm.member_id
      JOIN branches b ON b.id = m.branch_id
      WHERE mm.status = 'active'
        AND mm.end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')
        AND NOT EXISTS (
          SELECT 1 FROM notifications n 
          WHERE n.member_id = m.id 
            AND n.type = 'expiring_membership' 
            AND n.created_at > NOW() - INTERVAL '7 days'
        )
    `;
    await pool.query(query, [userId]);
  } catch (error) {
    console.error("Failed to generate notifications", error);
  }
};

const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Lazily generate expiring notifications
    await generateExpiringNotifications(userId);

    const result = await pool.query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 OR type IN ('MEMBER_ADDED', 'SUBSCRIPTION_ADDED')
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
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
  markAsRead
};
