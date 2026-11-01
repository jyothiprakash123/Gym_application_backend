const pool = require("../src/config/db");

async function run() {
  // 1. Roles
  const roles = await pool.query("SELECT * FROM roles ORDER BY name");
  console.log("=== ROLES (" + roles.rows.length + ") ===");
  console.table(roles.rows);

  // 2. Billing Plans
  const plans = await pool.query("SELECT * FROM billing_plans");
  console.log("=== BILLING PLANS (" + plans.rows.length + ") ===");
  console.table(plans.rows);

  // 3. Menu Items (where is_placeholder is false)
  const menu = await pool.query("SELECT * FROM menu_items WHERE is_placeholder = false ORDER BY sort_order ASC");
  console.log("=== CLEAN MENU ITEMS (" + menu.rows.length + ") ===");
  console.table(menu.rows.map(m => ({ sort: m.sort_order, type: m.type, text: m.text, path: m.path })));

  // 4. Role Menu Items count
  const rmi = await pool.query("SELECT COUNT(*) FROM role_menu_items");
  console.log("Role Menu Items count:", rmi.rows[0].count);

  // 5. Gym Module Configs
  const modConfigs = await pool.query("SELECT * FROM gym_module_configs WHERE gym_id IS NULL");
  console.log("Common Module Configs count:", modConfigs.rows.length);

  // 6. Gym Role Permissions
  const rolePerms = await pool.query("SELECT * FROM gym_role_permissions WHERE gym_id IS NULL");
  console.log("Common Role Permissions count:", rolePerms.rows.length);

  // 7. Core Gyms
  const gyms = await pool.query("SELECT * FROM gyms WHERE id IN ('6ecfc033-52f1-444f-a3f6-65fdd664c988', '4e440296-d558-46e6-b0f6-5fad5910a8f3', '1d993780-4a56-4c02-8b31-c8af71c86ff7')");
  console.log("=== CORE GYMS (" + gyms.rows.length + ") ===");
  console.table(gyms.rows.map(g => ({ id: g.id, name: g.name, email: g.email, phone: g.phone })));

  // 8. Core Branches
  const branches = await pool.query("SELECT * FROM branches WHERE gym_id IN ('6ecfc033-52f1-444f-a3f6-65fdd664c988', '4e440296-d558-46e6-b0f6-5fad5910a8f3', '1d993780-4a56-4c02-8b31-c8af71c86ff7')");
  console.log("=== CORE BRANCHES (" + branches.rows.length + ") ===");
  console.table(branches.rows.map(b => ({ id: b.id, name: b.name, gym_id: b.gym_id })));

  // 9. Core Users
  const users = await pool.query(`
    SELECT u.id, u.email, u.full_name, u.phone, u.password_hash, u.gym_id, u.branch_id, u.is_active, r.name as role_name
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE u.email IN ('admin@gym.com', 'jpsmart27@gmail.com', 'naveenprakash178@gmail.com', 'test@gym.com')
       OR (u.gym_id = '6ecfc033-52f1-444f-a3f6-65fdd664c988' AND u.email NOT LIKE '%prompt%')
  `);
  console.log("=== CORE LOGIN USERS (" + users.rows.length + ") ===");
  console.table(users.rows.map(u => ({ id: u.id, email: u.email, name: u.full_name, role: u.role_name })));

  pool.end();
}

run().catch(e => { console.error(e); pool.end(); });
