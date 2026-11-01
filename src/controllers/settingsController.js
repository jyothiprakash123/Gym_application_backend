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
      WHERE rm.role_id = $1 AND (m.is_placeholder IS NOT TRUE)
      ORDER BY m.sort_order ASC
    `;
    
    const result = await pool.query(query, [roleId]);
    let items = result.rows;

    // Filter by disabled modules for this gym (or common)
    try {
      const gymId = req.user.gym_id;
      let modRows = [];
      if (gymId) {
        const specificRes = await pool.query(
          `SELECT module_id, path, is_enabled FROM gym_module_configs WHERE gym_id = $1`,
          [gymId]
        );
        if (specificRes.rows.length > 0) {
          modRows = specificRes.rows;
        }
      }
      if (modRows.length === 0) {
        const commonRes = await pool.query(
          `SELECT module_id, path, is_enabled FROM gym_module_configs WHERE gym_id IS NULL`
        );
        modRows = commonRes.rows;
      }
      const disabledPaths = modRows.filter(m => m.is_enabled === false).map(m => m.path).filter(Boolean);
      if (disabledPaths.length > 0) {
        items = items.filter(item => !disabledPaths.includes(item.path));
      }
    } catch (e) {
      console.warn("Could not filter sidebar by disabled modules", e);
    }
    
    return res.status(200).json({
      success: true,
      data: {
        menu_items: items,
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
    const query = `SELECT * FROM menu_items WHERE is_placeholder IS NOT TRUE ORDER BY sort_order ASC`;
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
    const { menu_item_ids } = req.body;
    
    await client.query('BEGIN');
    
    await client.query('DELETE FROM role_menu_items WHERE role_id = $1', [role_id]);
    
    if (menu_item_ids && menu_item_ids.length > 0) {
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

// ======================================================
// DEFAULT PERMISSIONS & MODULE CONFIGURATIONS
// ======================================================

const DEFAULT_GRANULAR_PERMISSIONS = {
  "admin": {
    "members:view": true,
    "members:add": true,
    "members:edit": true,
    "members:delete": true,
    "members:duplicate": true,
    "members:import": true,
    "members:export": true,
    "members:hold_fees": true,
    "staff:view": true,
    "staff:add": true,
    "staff:edit": true,
    "staff:delete": true,
    "staff:assign": true,
    "attendance:view": true,
    "attendance:checkin": true,
    "attendance:bulk": true,
    "attendance:biometric": true,
    "payments:view": true,
    "payments:collect": true,
    "payments:discount": true,
    "payments:refund": true,
    "payments:delete": true,
    "plans:view": true,
    "plans:create": true,
    "plans:edit": true,
    "plans:delete": true,
    "leads:view": true,
    "leads:add": true,
    "leads:edit": true,
    "leads:convert": true,
    "leads:delete": true,
    "ai:view": true,
    "ai:generate_workout": true,
    "ai:generate_diet": true,
    "ai:edit": true,
    "settings:general": true,
    "settings:modules": true,
    "settings:permissions": true,
  },
  "front-desk": {
    "members:view": true,
    "members:add": true,
    "members:edit": true,
    "members:delete": false,
    "members:duplicate": true,
    "members:import": false,
    "members:export": true,
    "members:hold_fees": true,
    "staff:view": true,
    "staff:add": false,
    "staff:edit": false,
    "staff:delete": false,
    "staff:assign": false,
    "attendance:view": true,
    "attendance:checkin": true,
    "attendance:bulk": true,
    "attendance:biometric": false,
    "payments:view": true,
    "payments:collect": true,
    "payments:discount": false,
    "payments:refund": false,
    "payments:delete": false,
    "plans:view": true,
    "plans:create": false,
    "plans:edit": false,
    "plans:delete": false,
    "leads:view": true,
    "leads:add": true,
    "leads:edit": true,
    "leads:convert": true,
    "leads:delete": false,
    "ai:view": false,
    "ai:generate_workout": false,
    "ai:generate_diet": false,
    "ai:edit": false,
    "settings:general": false,
    "settings:modules": false,
    "settings:permissions": false,
  },
  "trainer": {
    "members:view": true,
    "members:add": false,
    "members:edit": false,
    "members:delete": false,
    "members:duplicate": false,
    "members:import": false,
    "members:export": false,
    "members:hold_fees": false,
    "staff:view": true,
    "staff:add": false,
    "staff:edit": false,
    "staff:delete": false,
    "staff:assign": false,
    "attendance:view": true,
    "attendance:checkin": true,
    "attendance:bulk": false,
    "attendance:biometric": false,
    "payments:view": false,
    "payments:collect": false,
    "payments:discount": false,
    "payments:refund": false,
    "payments:delete": false,
    "plans:view": true,
    "plans:create": false,
    "plans:edit": false,
    "plans:delete": false,
    "leads:view": false,
    "leads:add": false,
    "leads:edit": false,
    "leads:convert": false,
    "leads:delete": false,
    "ai:view": true,
    "ai:generate_workout": true,
    "ai:generate_diet": true,
    "ai:edit": true,
    "settings:general": false,
    "settings:modules": false,
    "settings:permissions": false,
  },
  "accountant": {
    "members:view": true,
    "members:add": false,
    "members:edit": false,
    "members:delete": false,
    "members:duplicate": false,
    "members:import": false,
    "members:export": true,
    "members:hold_fees": true,
    "staff:view": true,
    "staff:add": false,
    "staff:edit": false,
    "staff:delete": false,
    "staff:assign": false,
    "attendance:view": false,
    "attendance:checkin": false,
    "attendance:bulk": false,
    "attendance:biometric": false,
    "payments:view": true,
    "payments:collect": true,
    "payments:discount": true,
    "payments:refund": true,
    "payments:delete": true,
    "plans:view": true,
    "plans:create": false,
    "plans:edit": false,
    "plans:delete": false,
    "leads:view": false,
    "leads:add": false,
    "leads:edit": false,
    "leads:convert": false,
    "leads:delete": false,
    "ai:view": false,
    "ai:generate_workout": false,
    "ai:generate_diet": false,
    "ai:edit": false,
    "settings:general": false,
    "settings:modules": false,
    "settings:permissions": false,
  },
  "super-admin": {
    "members:view": true,
    "members:add": true,
    "members:edit": true,
    "members:delete": true,
    "members:duplicate": true,
    "members:import": true,
    "members:export": true,
    "members:hold_fees": true,
    "staff:view": true,
    "staff:add": true,
    "staff:edit": true,
    "staff:delete": true,
    "staff:assign": true,
    "attendance:view": true,
    "attendance:checkin": true,
    "attendance:bulk": true,
    "attendance:biometric": true,
    "payments:view": true,
    "payments:collect": true,
    "payments:discount": true,
    "payments:refund": true,
    "payments:delete": true,
    "plans:view": true,
    "plans:create": true,
    "plans:edit": true,
    "plans:delete": true,
    "leads:view": true,
    "leads:add": true,
    "leads:edit": true,
    "leads:convert": true,
    "leads:delete": true,
    "ai:view": true,
    "ai:generate_workout": true,
    "ai:generate_diet": true,
    "ai:edit": true,
    "settings:general": true,
    "settings:modules": true,
    "settings:permissions": true,
  },
  "system-admin": {
    "members:view": true,
    "members:add": true,
    "members:edit": true,
    "members:delete": true,
    "members:duplicate": true,
    "members:import": true,
    "members:export": true,
    "members:hold_fees": true,
    "staff:view": true,
    "staff:add": true,
    "staff:edit": true,
    "staff:delete": true,
    "staff:assign": true,
    "attendance:view": true,
    "attendance:checkin": true,
    "attendance:bulk": true,
    "attendance:biometric": true,
    "payments:view": true,
    "payments:collect": true,
    "payments:discount": true,
    "payments:refund": true,
    "payments:delete": true,
    "plans:view": true,
    "plans:create": true,
    "plans:edit": true,
    "plans:delete": true,
    "leads:view": true,
    "leads:add": true,
    "leads:edit": true,
    "leads:convert": true,
    "leads:delete": true,
    "ai:view": true,
    "ai:generate_workout": true,
    "ai:generate_diet": true,
    "ai:edit": true,
    "settings:general": true,
    "settings:modules": true,
    "settings:permissions": true,
  }
};

const DEFAULT_MODULES = [
  { id: "members", name: "Members Management", path: "/members", icon: "Users", category: "People", description: "Register, manage, track memberships, duplicate & view member profiles", is_enabled: true, plan: "Starter" },
  { id: "staff", name: "Staff & Trainers", path: "/staff", icon: "Briefcase", category: "People", description: "Manage instructors, front desk staff, payroll and shifts", is_enabled: true, plan: "Growth" },
  { id: "leads_crm", name: "Leads / CRM", path: "/leads-crm", icon: "Target", category: "People", description: "Capture prospects, conversion pipelines, and sales follow-ups", is_enabled: true, plan: "Growth" },
  { id: "attendance", name: "Attendance & Check-in", path: "/attendance", icon: "Calendar", category: "Operations", description: "Daily check-ins, manual logs, qr codes, and attendance history", is_enabled: true, plan: "Starter" },
  { id: "face_fingerprint", name: "Face & Fingerprint Biometric", path: "/face-fingerprint", icon: "Fingerprint", category: "Operations", description: "Biometric device synchronization and access turnstile control", is_enabled: true, plan: "Growth" },
  { id: "membership_plans", name: "Membership Plans", path: "/membership-plans", icon: "Award", category: "Operations", description: "Create, configure packages, tiers, discounts, and validity", is_enabled: true, plan: "Starter" },
  { id: "payments", name: "Payments & Invoicing", path: "/payments", icon: "CreditCard", category: "Finance", description: "Payment records, fee collection, tax calculation and receipts", is_enabled: true, plan: "Starter" },
  { id: "expenses", name: "Expense Tracker", path: "/expenses", icon: "TrendingDown", category: "Finance", description: "Track gym overheads, maintenance, utility bills and equipment costs", is_enabled: true, plan: "Growth" },
  { id: "equipment", name: "Equipment & Assets", path: "/equipment", icon: "Dumbbell", category: "Operations", description: "Inventory maintenance, servicing logs, warranty & asset values", is_enabled: true, plan: "Pro" },
  { id: "achievements", name: "Achievements & Badges", path: "/achievements", icon: "Trophy", category: "Engagement", description: "Milestones, badges, streak rewards for member retention", is_enabled: true, plan: "Starter" },
  { id: "reviews", name: "Reviews & Feedback", path: "/reviews", icon: "Star", category: "Engagement", description: "Collect member testimonials, NPS ratings, and suggestions", is_enabled: true, plan: "Pro" },
  { id: "billing_invoices", name: "Billing & Invoices", path: "/billing-invoices", icon: "Receipt", category: "Finance", description: "Automated recurring billing, invoicing and GST tax filing", is_enabled: true, plan: "Pro" },
  { id: "coupons_referrals", name: "Coupons & Referrals", path: "/coupons-referrals", icon: "Tag", category: "Finance", description: "Discount promo codes, member referral rewards program", is_enabled: true, plan: "Pro" },
  { id: "reports", name: "Analytics & Reports", path: "/reports", icon: "BarChart3", category: "Analytics", description: "Revenue graphs, attendance trends, member growth dashboards", is_enabled: true, plan: "Pro" },
  { id: "workout_diet_ai", name: "Workout / Diet AI", path: "/workout-diet-ai", icon: "Sparkles", category: "AI Features", description: "AI generated workout routines and personalized nutrition diets", is_enabled: true, plan: "Enterprise" },
  { id: "ai_support_chatbot", name: "AI Support Chatbot", path: "/ai-support-chatbot", icon: "Bot", category: "AI Features", description: "24/7 AI virtual assistant for inquiries and FAQ responses", is_enabled: true, plan: "Enterprise" },
  { id: "attendance_insights", name: "Attendance Insights AI", path: "/attendance-insights", icon: "Brain", category: "AI Features", description: "Peak-hour predictions and member attendance behavioral forecasting", is_enabled: true, plan: "Enterprise" },
  { id: "churn_prediction", name: "Churn Prediction AI", path: "/churn-prediction", icon: "AlertTriangle", category: "AI Features", description: "Detect members at risk of quitting before membership expires", is_enabled: true, plan: "Enterprise" },
  { id: "revenue_forecast", name: "Revenue Forecast AI", path: "/revenue-forecast", icon: "TrendingUp", category: "AI Features", description: "Financial forecasting and monthly recurring revenue projections", is_enabled: true, plan: "Enterprise" },
  { id: "trainer_portal", name: "Trainer Portal", path: "/trainer-portal", icon: "GraduationCap", category: "Portals", description: "Dedicated trainer dashboard for client schedules & workout tracking", is_enabled: true, plan: "Enterprise" },
  { id: "member_portal", name: "Member Portal", path: "/member-portal", icon: "UserCheck", category: "Portals", description: "Member self-service portal for renewal, workouts and attendance", is_enabled: true, plan: "Enterprise" },
  { id: "notifications", name: "Notification Engine", path: "/notifications", icon: "Bell", category: "System", description: "Automated WhatsApp, SMS, and in-app member expiry reminders", is_enabled: true, plan: "Growth" }
];

// ======================================================
// GRANULAR PERMISSIONS HANDLERS (COMMON & GYM SPECIFIC)
// ======================================================

const getGranularPermissions = async (req, res, next) => {
  try {
    const isSystemAdmin = req.user.role_name === 'system-admin';
    let gymId = null;

    if (isSystemAdmin) {
      const rawGymId = req.query.gymId || null;
      gymId = (rawGymId && rawGymId !== 'all' && rawGymId !== '') ? rawGymId : null;
    } else {
      if (!req.user.gym_id) {
        return res.status(403).json({
          success: false,
          message: "Access restricted: No gym associated with your account."
        });
      }
      gymId = req.user.gym_id;
    }

    let permissions = JSON.parse(JSON.stringify(DEFAULT_GRANULAR_PERMISSIONS));
    let isGymOverridden = false;

    // 1. Fetch Common defaults from gym_role_permissions
    const commonPermRows = await pool.query(`
      SELECT role_id, permission_key, is_allowed FROM gym_role_permissions WHERE gym_id IS NULL
    `);

    commonPermRows.rows.forEach(r => {
      if (!permissions[r.role_id]) permissions[r.role_id] = {};
      permissions[r.role_id][r.permission_key] = r.is_allowed;
    });

    // 2. If gymId is given, fetch gym-specific overrides
    if (gymId) {
      const gymPermRows = await pool.query(`
        SELECT role_id, permission_key, is_allowed FROM gym_role_permissions WHERE gym_id = $1
      `, [gymId]);

      if (gymPermRows.rows.length > 0) {
        isGymOverridden = true;
        gymPermRows.rows.forEach(r => {
          if (!permissions[r.role_id]) permissions[r.role_id] = {};
          permissions[r.role_id][r.permission_key] = r.is_allowed;
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        permissions,
        scope: gymId ? 'gym' : 'common',
        gymId,
        is_overridden: isGymOverridden,
        defaults: DEFAULT_GRANULAR_PERMISSIONS
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateGranularPermissions = async (req, res, next) => {
  try {
    const { permissions } = req.body;
    const isSystemAdmin = req.user.role_name === 'system-admin';
    let gymId = null;

    if (isSystemAdmin) {
      const rawGymId = req.body.gymId || null;
      gymId = (rawGymId && rawGymId !== 'all' && rawGymId !== '') ? rawGymId : null;
    } else {
      if (!req.user.gym_id) {
        return res.status(403).json({
          success: false,
          message: "Access restricted: You only have control for your own gym."
        });
      }
      gymId = req.user.gym_id;
    }

    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({
        success: false,
        message: "Permissions object is required"
      });
    }

    // 1. Upsert into gym_role_permissions table
    for (const [roleId, permsObj] of Object.entries(permissions)) {
      if (permsObj && typeof permsObj === 'object') {
        for (const [permKey, allowed] of Object.entries(permsObj)) {
          await pool.query(`
            INSERT INTO gym_role_permissions (gym_id, role_id, permission_key, is_allowed, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), role_id, permission_key)
            DO UPDATE SET is_allowed = EXCLUDED.is_allowed, updated_at = NOW();
          `, [gymId, roleId, permKey, Boolean(allowed)]);
        }
      }
    }

    // 2. Also keep settings table synchronized for backward compatibility
    const valueStr = JSON.stringify(permissions);
    let existQuery = `SELECT id FROM settings WHERE key = 'role_granular_permissions'`;
    const existParams = [];
    if (gymId) {
      existQuery += ` AND gym_id = $1`;
      existParams.push(gymId);
    } else {
      existQuery += ` AND gym_id IS NULL`;
    }

    const existRes = await pool.query(existQuery, existParams);
    if (existRes.rows.length > 0) {
      await pool.query(
        `UPDATE settings SET value = $1, updated_at = NOW() WHERE id = $2`,
        [valueStr, existRes.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO settings (gym_id, key, value) VALUES ($1, 'role_granular_permissions', $2)`,
        [gymId, valueStr]
      );
    }

    return res.status(200).json({
      success: true,
      message: gymId ? "Gym-specific permissions saved successfully" : "Common system-wide permissions saved successfully",
      data: { permissions, scope: gymId ? 'gym' : 'common', gymId }
    });
  } catch (error) {
    next(error);
  }
};

const resetGymPermissionsToCommon = async (req, res, next) => {
  try {
    const isSystemAdmin = req.user.role_name === 'system-admin';
    let gymId = null;

    if (isSystemAdmin) {
      const rawGymId = req.body.gymId || null;
      gymId = (rawGymId && rawGymId !== 'all' && rawGymId !== '') ? rawGymId : null;
    } else {
      gymId = req.user.gym_id;
    }

    if (!gymId) {
      return res.status(400).json({ success: false, message: "A specific gymId is required to reset" });
    }

    await pool.query(`DELETE FROM gym_role_permissions WHERE gym_id = $1`, [gymId]);
    await pool.query(`DELETE FROM settings WHERE key = 'role_granular_permissions' AND gym_id = $1`, [gymId]);

    return res.status(200).json({
      success: true,
      message: "Gym permissions reset to Common defaults successfully"
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// MODULES CONFIG HANDLERS (COMMON & GYM SPECIFIC)
// ======================================================

const getModulesConfig = async (req, res, next) => {
  try {
    const isSystemAdmin = req.user.role_name === 'system-admin';
    let gymId = null;

    if (isSystemAdmin) {
      const rawGymId = req.query.gymId || null;
      gymId = (rawGymId && rawGymId !== 'all' && rawGymId !== '') ? rawGymId : null;
    } else {
      if (!req.user.gym_id) {
        return res.status(403).json({
          success: false,
          message: "Access restricted: No gym associated with your account."
        });
      }
      gymId = req.user.gym_id;
    }

    let gymInfo = null;
    let gymPlanModules = null;

    if (gymId) {
      // Fetch gym details and its billing plan features
      const gymQuery = `
        SELECT g.id, g.name, bp.name as plan_name, bp.features
        FROM gyms g
        LEFT JOIN billing_plans bp ON g.billing_plan_id = bp.id
        WHERE g.id = $1
      `;
      const gymRes = await pool.query(gymQuery, [gymId]);
      if (gymRes.rows.length > 0) {
        gymInfo = {
          id: gymRes.rows[0].id,
          name: gymRes.rows[0].name,
          plan_name: gymRes.rows[0].plan_name || 'Starter'
        };
        const features = gymRes.rows[0].features;
        if (features && Array.isArray(features.modules)) {
          gymPlanModules = features.modules;
        }
      }
    }

    // 1. Fetch Common defaults from gym_module_configs
    const commonRows = await pool.query(
      `SELECT module_id, module_name, category, path, is_enabled, plan_tier FROM gym_module_configs WHERE gym_id IS NULL ORDER BY created_at ASC`
    );
    const commonMap = {};
    commonRows.rows.forEach(r => {
      commonMap[r.module_id] = r;
    });

    // 2. If gymId is given, fetch gym-specific overrides
    let gymRows = [];
    const gymMap = {};
    let isGymOverridden = false;
    if (gymId) {
      const specificRes = await pool.query(
        `SELECT module_id, module_name, category, path, is_enabled, plan_tier FROM gym_module_configs WHERE gym_id = $1`,
        [gymId]
      );
      gymRows = specificRes.rows;
      if (gymRows.length > 0) {
        isGymOverridden = true;
        gymRows.forEach(r => {
          gymMap[r.module_id] = r;
        });
      }
    }

    // 3. Compose final module list with plan awareness
    const modules = DEFAULT_MODULES.map(defMod => {
      const commonMod = commonMap[defMod.id];
      const specificMod = gymMap[defMod.id];

      const is_enabled = specificMod !== undefined
        ? specificMod.is_enabled
        : (commonMod !== undefined ? commonMod.is_enabled : defMod.is_enabled);

      const plan_tier = commonMod?.plan_tier || defMod.plan || "Starter";

      // Check if module is in gym's plan (if gym has a plan)
      let is_in_plan = true;
      if (gymPlanModules) {
        is_in_plan = gymPlanModules.includes(defMod.id) ||
                     gymPlanModules.includes(defMod.id.replace(/_/g, '')) ||
                     gymPlanModules.includes(defMod.id.replace(/-/g, '_'));
      }

      return {
        ...defMod,
        is_enabled,
        plan_tier,
        is_in_plan,
        is_overridden: specificMod !== undefined
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        modules,
        scope: gymId ? 'gym' : 'common',
        gymId,
        gym: gymInfo,
        is_overridden: isGymOverridden,
        defaults: DEFAULT_MODULES
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateModulesConfig = async (req, res, next) => {
  try {
    const { modules } = req.body;
    const isSystemAdmin = req.user.role_name === 'system-admin';
    let gymId = null;

    if (isSystemAdmin) {
      const rawGymId = req.body.gymId || null;
      gymId = (rawGymId && rawGymId !== 'all' && rawGymId !== '') ? rawGymId : null;
    } else {
      if (!req.user.gym_id) {
        return res.status(403).json({
          success: false,
          message: "Access restricted: You only have control for your own gym."
        });
      }
      gymId = req.user.gym_id;
    }

    if (!Array.isArray(modules)) {
      return res.status(400).json({
        success: false,
        message: "Modules array is required"
      });
    }

    // 1. Save into gym_module_configs table
    for (const mod of modules) {
      await pool.query(`
        INSERT INTO gym_module_configs (
          gym_id, module_id, module_name, category, path, is_enabled, plan_tier, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), module_id)
        DO UPDATE SET 
          is_enabled = EXCLUDED.is_enabled,
          module_name = EXCLUDED.module_name,
          category = EXCLUDED.category,
          path = EXCLUDED.path,
          plan_tier = EXCLUDED.plan_tier,
          updated_at = NOW();
      `, [
        gymId,
        mod.id,
        mod.name,
        mod.category || 'MODULE SETTINGS',
        mod.path || `/${mod.id.replace('_', '-')}`,
        mod.is_enabled !== false,
        mod.plan_tier || mod.plan || 'Starter'
      ]);
    }

    // 2. Also keep settings table synchronized for backward compatibility
    const valueStr = JSON.stringify(modules);
    let existQuery = `SELECT id FROM settings WHERE key = 'gym_modules_config'`;
    const existParams = [];
    if (gymId) {
      existQuery += ` AND gym_id = $1`;
      existParams.push(gymId);
    } else {
      existQuery += ` AND gym_id IS NULL`;
    }

    const existRes = await pool.query(existQuery, existParams);
    if (existRes.rows.length > 0) {
      await pool.query(
        `UPDATE settings SET value = $1, updated_at = NOW() WHERE id = $2`,
        [valueStr, existRes.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO settings (gym_id, key, value) VALUES ($1, 'gym_modules_config', $2)`,
        [gymId, valueStr]
      );
    }

    return res.status(200).json({
      success: true,
      message: gymId ? "Gym-specific module configuration saved" : "Common system-wide module configuration saved",
      data: {
        modules,
        scope: gymId ? 'gym' : 'common',
        gymId
      }
    });
  } catch (error) {
    next(error);
  }
};

const resetGymModulesToCommon = async (req, res, next) => {
  try {
    const isSystemAdmin = req.user.role_name === 'system-admin';
    let gymId = null;

    if (isSystemAdmin) {
      const rawGymId = req.body.gymId || null;
      gymId = (rawGymId && rawGymId !== 'all' && rawGymId !== '') ? rawGymId : null;
    } else {
      gymId = req.user.gym_id;
    }

    if (!gymId) {
      return res.status(400).json({ success: false, message: "A specific gymId is required to reset" });
    }

    // Delete gym-specific overrides so it falls back to Common
    await pool.query(`DELETE FROM gym_module_configs WHERE gym_id = $1`, [gymId]);
    await pool.query(`DELETE FROM settings WHERE key = 'gym_modules_config' AND gym_id = $1`, [gymId]);

    return res.status(200).json({
      success: true,
      message: "Gym module configuration reset to Common defaults"
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// ROLES CRUD FOR SETTINGS (SCREENSHOT 1 & SCREENSHOT 2)
// ======================================================

const getRolesList = async (req, res, next) => {
  try {
    // Ensure helper columns exist if not already present
    try {
      await pool.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_accountant BOOLEAN DEFAULT FALSE;`);
      await pool.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;`);
    } catch (e) {
      // ignore if migration not supported
    }

    const result = await pool.query(`
      SELECT id, name, description, 
             COALESCE(is_accountant, false) as is_accountant, 
             COALESCE(is_default, false) as is_default, 
             created_at 
      FROM roles 
      ORDER BY created_at ASC
    `);

    const standardSystemRoles = ['system-admin', 'super-admin', 'admin', 'trainer', 'front-desk', 'accountant'];

    const roles = result.rows.map(r => ({
      ...r,
      is_default: standardSystemRoles.includes(r.name?.toLowerCase()) || Boolean(r.is_default)
    }));

    return res.status(200).json({
      success: true,
      data: {
        roles
      }
    });
  } catch (error) {
    next(error);
  }
};

const createRole = async (req, res, next) => {
  try {
    const { name, description, is_accountant, permissions } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Role name is required" });
    }

    const cleanName = name.trim();

    // Check duplicate
    const check = await pool.query(`SELECT id FROM roles WHERE LOWER(name) = LOWER($1)`, [cleanName]);
    if (check.rows.length > 0) {
      return res.status(409).json({ success: false, message: `Role '${cleanName}' already exists` });
    }

    const insertRes = await pool.query(
      `INSERT INTO roles (name, description, is_accountant, is_default) VALUES ($1, $2, $3, false) RETURNING *`,
      [cleanName, description || '', Boolean(is_accountant)]
    );

    const newRole = insertRes.rows[0];

    // If permissions supplied, save them
    if (permissions && typeof permissions === 'object') {
      const gymId = req.user.gym_id || null;
      for (const [permKey, allowed] of Object.entries(permissions)) {
        await pool.query(`
          INSERT INTO gym_role_permissions (gym_id, role_id, permission_key, is_allowed, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), role_id, permission_key)
          DO UPDATE SET is_allowed = EXCLUDED.is_allowed, updated_at = NOW();
        `, [gymId, newRole.name, permKey, Boolean(allowed)]);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: newRole
    });
  } catch (error) {
    next(error);
  }
};

const updateRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, is_accountant, permissions } = req.body;

    const updateRes = await pool.query(
      `UPDATE roles 
       SET name = COALESCE($1, name), 
           description = COALESCE($2, description),
           is_accountant = COALESCE($3, is_accountant)
       WHERE id = $4 RETURNING *`,
      [name?.trim(), description, is_accountant !== undefined ? Boolean(is_accountant) : null, id]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    const updatedRole = updateRes.rows[0];

    // If permissions supplied, save them
    if (permissions && typeof permissions === 'object') {
      const gymId = req.user.gym_id || null;
      for (const [permKey, allowed] of Object.entries(permissions)) {
        await pool.query(`
          INSERT INTO gym_role_permissions (gym_id, role_id, permission_key, is_allowed, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), role_id, permission_key)
          DO UPDATE SET is_allowed = EXCLUDED.is_allowed, updated_at = NOW();
        `, [gymId, updatedRole.name, permKey, Boolean(allowed)]);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Role updated successfully",
      data: updatedRole
    });
  } catch (error) {
    next(error);
  }
};

const deleteRole = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if role is in use
    const userCheck = await pool.query(`SELECT id FROM users WHERE role_id = $1 LIMIT 1`, [id]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Cannot delete role because it is currently assigned to users" 
      });
    }

    // Check if default
    const roleCheck = await pool.query(`SELECT name, is_default FROM roles WHERE id = $1`, [id]);
    if (roleCheck.rows.length > 0 && (roleCheck.rows[0].is_default || ['admin', 'super-admin', 'system-admin'].includes(roleCheck.rows[0].name.toLowerCase()))) {
      return res.status(400).json({
        success: false,
        message: "This is a default system role and cannot be deleted."
      });
    }

    await pool.query(`DELETE FROM roles WHERE id = $1`, [id]);

    return res.status(200).json({
      success: true,
      message: "Role deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// MASTERS CONFIGURATIONS (SYSTEM ADMIN ONLY)
// ======================================================

const getMasterConfigs = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT key, value 
      FROM settings 
      WHERE key IN ('master_plan_sidebar_visibility', 'master_quick_navigation', 'master_dark_theme')
        AND gym_id IS NULL
    `);
    
    const configs = {
      plan_sidebar_visibility: true,
      quick_navigation: true,
      dark_theme: true
    };

    result.rows.forEach(r => {
      if (r.key === 'master_plan_sidebar_visibility') configs.plan_sidebar_visibility = r.value === 'true' || r.value === true;
      if (r.key === 'master_quick_navigation') configs.quick_navigation = r.value === 'true' || r.value === true;
      if (r.key === 'master_dark_theme') configs.dark_theme = r.value === 'true' || r.value === true;
    });

    return res.status(200).json({
      success: true,
      data: {
        configs
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateMasterConfigs = async (req, res, next) => {
  try {
    // Only System Admin can manage these settings
    if (req.user?.role_name !== 'system-admin') {
      return res.status(403).json({
        success: false,
        message: "Access restricted: Only System Admin can manage Masters configurations."
      });
    }

    const { plan_sidebar_visibility, quick_navigation, dark_theme } = req.body;

    const itemsToUpdate = [
      { key: 'master_plan_sidebar_visibility', val: String(plan_sidebar_visibility !== false) },
      { key: 'master_quick_navigation', val: String(quick_navigation !== false) },
      { key: 'master_dark_theme', val: String(dark_theme !== false) }
    ];

    for (const item of itemsToUpdate) {
      const exist = await pool.query(
        `SELECT id FROM settings WHERE key = $1 AND gym_id IS NULL`,
        [item.key]
      );
      if (exist.rows.length > 0) {
        await pool.query(
          `UPDATE settings SET value = $1, updated_at = NOW() WHERE id = $2`,
          [item.val, exist.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO settings (gym_id, key, value, updated_at) VALUES (NULL, $1, $2, NOW())`,
          [item.key, item.val]
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "Masters configurations updated successfully",
      data: {
        configs: {
          plan_sidebar_visibility: plan_sidebar_visibility !== false,
          quick_navigation: quick_navigation !== false,
          dark_theme: dark_theme !== false
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSidebar,
  getAllMenuItems,
  getRolePermissions,
  updateRolePermissions,
  getGranularPermissions,
  updateGranularPermissions,
  resetGymPermissionsToCommon,
  getModulesConfig,
  updateModulesConfig,
  resetGymModulesToCommon,
  getRolesList,
  createRole,
  updateRole,
  deleteRole,
  getMasterConfigs,
  updateMasterConfigs
};
