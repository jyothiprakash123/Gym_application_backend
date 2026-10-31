const pool = require("../config/db");

const DEFAULT_MODULES_DATA = [
  { id: "members", name: "Members", path: "/members", category: "MODULE SETTINGS", plan_tier: "Starter", is_enabled: true },
  { id: "staff", name: "Staff & Trainers", path: "/staff", category: "MODULE SETTINGS", plan_tier: "Growth", is_enabled: true },
  { id: "attendance", name: "Attendance & Access", path: "/attendance", category: "MODULE SETTINGS", plan_tier: "Starter", is_enabled: true },
  { id: "payments", name: "Payments & Billing", path: "/payments", category: "MODULE SETTINGS", plan_tier: "Starter", is_enabled: true },
  { id: "membership_plans", name: "Membership Plans", path: "/membership-plans", category: "MODULE SETTINGS", plan_tier: "Starter", is_enabled: true },
  { id: "leads_crm", name: "Leads / CRM", path: "/leads-crm", category: "MODULE SETTINGS", plan_tier: "Growth", is_enabled: true },
  { id: "workout_diet_ai", name: "Workout / Diet AI", path: "/workout-diet-ai", category: "MODULE SETTINGS", plan_tier: "Enterprise", is_enabled: true },
  { id: "equipment", name: "Equipment & Maintenance", path: "/equipment", category: "MODULE SETTINGS", plan_tier: "Pro", is_enabled: true },
  { id: "expenses", name: "Expenses Tracker", path: "/expenses", category: "MODULE SETTINGS", plan_tier: "Growth", is_enabled: true },
  { id: "messages", name: "Messages & Notices", path: "/messages", category: "MODULE SETTINGS", plan_tier: "Starter", is_enabled: true }
];

const DEFAULT_ROLE_PERMS_DATA = {
  "admin": {
    "members:view": true, "members:add": true, "members:edit": true, "members:delete": true, "members:duplicate": true, "members:import": true, "members:export": true, "members:hold_fees": true,
    "staff:view": true, "staff:add": true, "staff:edit": true, "staff:delete": true, "staff:assign": true,
    "attendance:view": true, "attendance:checkin": true, "attendance:bulk": true, "attendance:biometric": true,
    "payments:view": true, "payments:collect": true, "payments:discount": true, "payments:refund": true, "payments:delete": true,
    "messages:view": true, "messages:add": true, "messages:edit": true, "messages:delete": true
  },
  "front-desk": {
    "members:view": true, "members:add": true, "members:edit": true, "members:delete": false, "members:duplicate": true, "members:import": false, "members:export": true, "members:hold_fees": true,
    "staff:view": true, "staff:add": false, "staff:edit": false, "staff:delete": false, "staff:assign": false,
    "attendance:view": true, "attendance:checkin": true, "attendance:bulk": true, "attendance:biometric": false,
    "payments:view": true, "payments:collect": true, "payments:discount": false, "payments:refund": false, "payments:delete": false,
    "messages:view": true, "messages:add": true, "messages:edit": true, "messages:delete": false
  },
  "trainer": {
    "members:view": true, "members:add": false, "members:edit": false, "members:delete": false, "members:duplicate": false, "members:import": false, "members:export": false, "members:hold_fees": false,
    "staff:view": true, "staff:add": false, "staff:edit": false, "staff:delete": false, "staff:assign": false,
    "attendance:view": true, "attendance:checkin": true, "attendance:bulk": false, "attendance:biometric": false,
    "payments:view": false, "payments:collect": false, "payments:discount": false, "payments:refund": false, "payments:delete": false,
    "messages:view": true, "messages:add": false, "messages:edit": false, "messages:delete": false
  },
  "accountant": {
    "members:view": true, "members:add": false, "members:edit": false, "members:delete": false, "members:duplicate": false, "members:import": false, "members:export": true, "members:hold_fees": true,
    "staff:view": true, "staff:add": false, "staff:edit": false, "staff:delete": false, "staff:assign": false,
    "attendance:view": false, "attendance:checkin": false, "attendance:bulk": false, "attendance:biometric": false,
    "payments:view": true, "payments:collect": true, "payments:discount": true, "payments:refund": true, "payments:delete": true,
    "messages:view": true, "messages:add": false, "messages:edit": false, "messages:delete": false
  }
};

const initSettingsTables = async () => {
  try {
    // 1. Table for gym module configs (Common where gym_id IS NULL, or gym specific where gym_id = UUID)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_module_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE,
        module_id VARCHAR(100) NOT NULL,
        module_name VARCHAR(150) NOT NULL,
        category VARCHAR(100) DEFAULT 'MODULE SETTINGS',
        path VARCHAR(100),
        is_enabled BOOLEAN NOT NULL DEFAULT true,
        plan_tier VARCHAR(50) DEFAULT 'Starter',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Ensure unique index per (gym_id, module_id) using COALESCE for NULL (Common)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_module_configs 
      ON gym_module_configs (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), module_id);
    `);

    // 2. Table for gym role permissions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_role_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE,
        role_id VARCHAR(100) NOT NULL,
        permission_key VARCHAR(100) NOT NULL,
        is_allowed BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_role_permissions 
      ON gym_role_permissions (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), role_id, permission_key);
    `);

    // 3. Create messages table for branch announcements and notices
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(100) DEFAULT 'Closure / Holiday',
        priority VARCHAR(50) DEFAULT 'Normal',
        start_date DATE DEFAULT CURRENT_DATE,
        end_date DATE,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_gym_branch ON messages (gym_id, branch_id);
      CREATE INDEX IF NOT EXISTS idx_messages_is_active ON messages (is_active);
    `);

    // 4. Ensure Messages menu item exists in menu_items table
    const menuCheck = await pool.query("SELECT id FROM menu_items WHERE path = '/messages'");
    let messageMenuItemId;
    if (menuCheck.rows.length === 0) {
      const insertMenu = await pool.query(`
        INSERT INTO menu_items (id, type, path, icon, text, plan, required_role, sort_order)
        VALUES (gen_random_uuid(), 'link', '/messages', 'Megaphone', 'Messages', 'Starter', null, 17)
        RETURNING id
      `);
      messageMenuItemId = insertMenu.rows[0].id;
    } else {
      messageMenuItemId = menuCheck.rows[0].id;
    }

    // Assign /messages menu item to all roles
    const allRoles = await pool.query("SELECT id FROM roles");
    for (const roleRow of allRoles.rows) {
      await pool.query(`
        INSERT INTO role_menu_items (role_id, menu_item_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [roleRow.id, messageMenuItemId]);
    }

    // 5. Seed Common defaults in gym_module_configs if none exist
    const commonCountRes = await pool.query(`
      SELECT COUNT(*) as count FROM gym_module_configs WHERE gym_id IS NULL;
    `);

    if (parseInt(commonCountRes.rows[0].count, 10) === 0) {
      console.log("Seeding Common / System-wide default modules in gym_module_configs...");
      for (const mod of DEFAULT_MODULES_DATA) {
        await pool.query(`
          INSERT INTO gym_module_configs (gym_id, module_id, module_name, category, path, is_enabled, plan_tier)
          VALUES (NULL, $1, $2, $3, $4, $5, $6)
          ON CONFLICT (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), module_id)
          DO NOTHING;
        `, [mod.id, mod.name, mod.category, mod.path, mod.is_enabled, mod.plan_tier]);
      }
    } else {
      // Ensure messages module config exists
      await pool.query(`
        INSERT INTO gym_module_configs (gym_id, module_id, module_name, category, path, is_enabled, plan_tier)
        VALUES (NULL, 'messages', 'Messages & Notices', 'MODULE SETTINGS', '/messages', true, 'Starter')
        ON CONFLICT (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), module_id)
        DO NOTHING;
      `);
    }

    // 6. Seed Common defaults in gym_role_permissions if none exist
    const commonPermCountRes = await pool.query(`
      SELECT COUNT(*) as count FROM gym_role_permissions WHERE gym_id IS NULL;
    `);

    if (parseInt(commonPermCountRes.rows[0].count, 10) === 0) {
      console.log("Seeding Common / System-wide role permissions in gym_role_permissions...");
      for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMS_DATA)) {
        for (const [permKey, allowed] of Object.entries(perms)) {
          await pool.query(`
            INSERT INTO gym_role_permissions (gym_id, role_id, permission_key, is_allowed)
            VALUES (NULL, $1, $2, $3)
            ON CONFLICT (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), role_id, permission_key)
            DO NOTHING;
          `, [role, permKey, allowed]);
        }
      }
    }

    // 7. Seed Sample Messages for existing gyms if messages table is empty
    const msgCountRes = await pool.query("SELECT COUNT(*) as count FROM messages");
    if (parseInt(msgCountRes.rows[0].count, 10) === 0) {
      console.log("Seeding initial sample messages...");
      const gymsRes = await pool.query("SELECT id, name FROM gyms");
      for (const g of gymsRes.rows) {
        // Fetch a branch for this gym if available
        const branchRes = await pool.query("SELECT id, name FROM branches WHERE gym_id = $1 LIMIT 2", [g.id]);
        const branch1 = branchRes.rows[0];
        const branch2 = branchRes.rows[1];

        // 1. Common Message across ALL branches
        await pool.query(`
          INSERT INTO messages (gym_id, branch_id, title, content, category, priority, start_date, end_date, is_active)
          VALUES ($1, NULL, 'Gym will be closed today', 'Attention members: The facility will be closed today for scheduled electrical and deep sanitization work. We will resume normal operational hours tomorrow at 6:00 AM.', 'Closure / Holiday', 'Urgent', CURRENT_DATE, CURRENT_DATE, true)
        `, [g.id]);

        // 2. Branch specific message
        if (branch1) {
          await pool.query(`
            INSERT INTO messages (gym_id, branch_id, title, content, category, priority, start_date, end_date, is_active)
            VALUES ($1, $2, 'Steam Room & Sauna Maintenance', 'The steam room and sauna at ${branch1.name} will be undergoing scheduled filter replacement today from 11:00 AM to 4:00 PM. All other workout zones remain fully open.', 'Maintenance', 'High', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 day', true)
          `, [g.id, branch1.id]);
        }

        // 3. Announcement
        await pool.query(`
          INSERT INTO messages (gym_id, branch_id, title, content, category, priority, start_date, end_date, is_active)
          VALUES ($1, NULL, 'Upcoming Weekend HIIT Masterclass', 'Join our head trainer for a special 60-minute explosive HIIT Masterclass this Saturday at 8:30 AM! Open to all active membership tiers. Reserve your spot at the front desk.', 'Announcement', 'Normal', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days', true)
        `, [g.id]);

        if (branch2) {
          await pool.query(`
            INSERT INTO messages (gym_id, branch_id, title, content, category, priority, start_date, end_date, is_active)
            VALUES ($1, $2, 'New Cardio Equipment Arrival', 'New advanced treadmills and elliptical cross-trainers have arrived at ${branch2.name}. Check out the upgraded cardio deck today!', 'General', 'Normal', CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '7 days', true)
          `, [g.id, branch2.id]);
        }
      }
    }

    console.log("Settings and Messages tables initialized successfully.");
  } catch (error) {
    console.error("Error initializing settings tables:", error);
  }
};

module.exports = {
  initSettingsTables,
  DEFAULT_MODULES_DATA,
  DEFAULT_ROLE_PERMS_DATA
};
