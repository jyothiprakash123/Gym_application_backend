const pool = require("../config/db");

// ======================================================
// GET SIDEBAR MENU ITEMS FOR CURRENT USER ROLE
// ======================================================

const getSidebar = async (req, res, next) => {
  try {
    const roleId = req.user.role_id;
    
    // Fetch all menu items that the user's role has permission to see
    // Ordered by sort_order
    const query = `
      SELECT m.* 
      FROM menu_items m
      JOIN role_menu_items rm ON m.id = rm.menu_item_id
      WHERE rm.role_id = $1
      ORDER BY m.sort_order ASC
    `;
    
    const result = await pool.query(query, [roleId]);
    
    return res.status(200).json({
      success: true,
      data: {
        menu_items: result.rows,
      }
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET ALL MENU ITEMS (FOR ADMIN SETTINGS UI)
// ======================================================

const getAllMenuItems = async (req, res, next) => {
  try {
    const query = `SELECT * FROM menu_items ORDER BY sort_order ASC`;
    const result = await pool.query(query);
    
    return res.status(200).json({
      success: true,
      data: {
        menu_items: result.rows,
      }
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// GET PERMISSIONS FOR A ROLE
// ======================================================

const getRolePermissions = async (req, res, next) => {
  try {
    const { role_id } = req.params;
    
    const query = `
      SELECT m.id, m.text, m.type, m.path,
             CASE WHEN rm.role_id IS NOT NULL THEN true ELSE false END as has_permission
      FROM menu_items m
      LEFT JOIN role_menu_items rm ON m.id = rm.menu_item_id AND rm.role_id = $1
      ORDER BY m.sort_order ASC
    `;
    
    const result = await pool.query(query, [role_id]);
    
    return res.status(200).json({
      success: true,
      data: {
        permissions: result.rows,
      }
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPDATE PERMISSIONS FOR A ROLE
// ======================================================

const updateRolePermissions = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { role_id } = req.params;
    const { menu_item_ids } = req.body; // Array of menu_item_ids that should be allowed
    
    await client.query('BEGIN');
    
    // Remove existing
    await client.query('DELETE FROM role_menu_items WHERE role_id = $1', [role_id]);
    
    // Insert new
    if (menu_item_ids && menu_item_ids.length > 0) {
      // Build the query
      // INSERT INTO role_menu_items (role_id, menu_item_id) VALUES ($1, $2), ($1, $3)...
      const values = [];
      let queryText = 'INSERT INTO role_menu_items (role_id, menu_item_id) VALUES ';
      
      let paramIndex = 1;
      values.push(role_id);
      
      menu_item_ids.forEach((menuId, index) => {
        paramIndex++;
        values.push(menuId);
        queryText += `($1, $${paramIndex})`;
        if (index < menu_item_ids.length - 1) {
          queryText += ', ';
        }
      });
      
      await client.query(queryText, values);
    }
    
    await client.query('COMMIT');
    
    return res.status(200).json({
      success: true,
      message: "Permissions updated successfully"
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getSidebar,
  getAllMenuItems,
  getRolePermissions,
  updateRolePermissions
};
