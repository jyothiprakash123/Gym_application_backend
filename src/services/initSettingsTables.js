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
  { id: "expenses", name: "Expenses Tracker", path: "/expenses", category: "MODULE SETTINGS", plan_tier: "Growth", is_enabled: true }
];

const DEFAULT_ROLE_PERMS_DATA = {
  "admin": {
    "members:view": true, "members:add": true, "members:edit": true, "members:delete": true, "members:duplicate": true, "members:import": true, "members:export": true, "members:hold_fees": true,
    "staff:view": true, "staff:add": true, "staff:edit": true, "staff:delete": true, "staff:assign": true,
    "attendance:view": true, "attendance:checkin": true, "attendance:bulk": true, "attendance:biometric": true,
    "payments:view": true, "payments:collect": true, "payments:discount": true, "payments:refund": true, "payments:delete": true
  },
  "front-desk": {
    "members:view": true, "members:add": true, "members:edit": true, "members:delete": false, "members:duplicate": true, "members:import": false, "members:export": true, "members:hold_fees": true,
    "staff:view": true, "staff:add": false, "staff:edit": false, "staff:delete": false, "staff:assign": false,
    "attendance:view": true, "attendance:checkin": true, "attendance:bulk": true, "attendance:biometric": false,
    "payments:view": true, "payments:collect": true, "payments:discount": false, "payments:refund": false, "payments:delete": false
  },
  "trainer": {
    "members:view": true, "members:add": false, "members:edit": false, "members:delete": false, "members:duplicate": false, "members:import": false, "members:export": false, "members:hold_fees": false,
    "staff:view": true, "staff:add": false, "staff:edit": false, "staff:delete": false, "staff:assign": false,
    "attendance:view": true, "attendance:checkin": true, "attendance:bulk": false, "attendance:biometric": false,
    "payments:view": false, "payments:collect": false, "payments:discount": false, "payments:refund": false, "payments:delete": false
  },
  "accountant": {
    "members:view": true, "members:add": false, "members:edit": false, "members:delete": false, "members:duplicate": false, "members:import": false, "members:export": true, "members:hold_fees": true,
    "staff:view": true, "staff:add": false, "staff:edit": false, "staff:delete": false, "staff:assign": false,
    "attendance:view": false, "attendance:checkin": false, "attendance:bulk": false, "attendance:biometric": false,
    "payments:view": true, "payments:collect": true, "payments:discount": true, "payments:refund": true, "payments:delete": true
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

    // 3. Seed Common defaults in gym_module_configs if none exist
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
    }

    // 4. Seed Common defaults in gym_role_permissions if none exist
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

    console.log("Settings tables (gym_module_configs, gym_role_permissions) initialized successfully.");
  } catch (error) {
    console.error("Error initializing settings tables:", error);
  }
};

module.exports = {
  initSettingsTables,
  DEFAULT_MODULES_DATA,
  DEFAULT_ROLE_PERMS_DATA
};
