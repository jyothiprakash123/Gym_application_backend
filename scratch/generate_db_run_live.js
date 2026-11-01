const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

function sqlEscape(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === "object") return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

function generateInserts(tableName, rows, conflictClause = "ON CONFLICT DO NOTHING") {
  if (!rows || rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  let sql = `-- ==========================================================================\n`;
  sql += `-- DATA: ${tableName} (${rows.length} rows)\n`;
  sql += `-- ==========================================================================\n`;
  for (const row of rows) {
    const vals = cols.map((c) => sqlEscape(row[c])).join(", ");
    sql += `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${vals}) ${conflictClause};\n`;
  }
  sql += "\n";
  return sql;
}

async function main() {
  console.log("Generating complete live SQL script (schema + masters + login users)...");

  // Read schema dump
  const schemaRaw = fs.readFileSync(path.join(__dirname, "schema_utf8.sql"), "utf8");
  // Clean out \restrict command
  const cleanSchema = schemaRaw
    .split("\n")
    .filter((line) => !line.startsWith("\\restrict"))
    .join("\n");

  let out = "";
  out += `-- ==========================================================================\n`;
  out += `-- FitZone Gym SaaS - Complete Live Database & Master Seeds\n`;
  out += `-- Generated: 01-11-2026\n`;
  out += `-- Contents:\n`;
  out += `--   1. Full Database Schema (Tables, Extensions, Indexes, Sequences, Foreign Keys)\n`;
  out += `--   2. Master Data Inserts (Roles, SaaS Billing Plans, Clean Menu Items, RBAC Perms, Common Module Configs)\n`;
  out += `--   3. Core Tenants & Login Users (System Admin, Super Admins, Branch Staff with Bcrypt Hashes)\n`;
  out += `-- ==========================================================================\n\n`;

  out += cleanSchema;
  out += "\n\n";
  out += `-- ==========================================================================\n`;
  out += `-- PART 2: MASTER DATA INSERTS\n`;
  out += `-- ==========================================================================\n\n`;

  // 1. Roles
  const rolesRes = await pool.query("SELECT id, name, description, created_at, is_accountant, is_default FROM roles ORDER BY name");
  out += generateInserts("roles", rolesRes.rows, "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description");

  // 2. Billing Plans
  const plansRes = await pool.query("SELECT * FROM billing_plans ORDER BY name");
  out += generateInserts("billing_plans", plansRes.rows, "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name");

  // 3. Clean Core Gyms (for tenant scoping)
  const coreGymIds = [
    '6ecfc033-52f1-444f-a3f6-65fdd664c988',
    '4e440296-d558-46e6-b0f6-5fad5910a8f3',
    '1d993780-4a56-4c02-8b31-c8af71c86ff7'
  ];
  const gymsRes = await pool.query(`SELECT * FROM gyms WHERE id = ANY($1::uuid[])`, [coreGymIds]);
  out += generateInserts("gyms", gymsRes.rows, "ON CONFLICT (id) DO NOTHING");

  // 4. Core Branches
  const branchesRes = await pool.query(`SELECT * FROM branches WHERE gym_id = ANY($1::uuid[])`, [coreGymIds]);
  out += generateInserts("branches", branchesRes.rows, "ON CONFLICT (id) DO NOTHING");

  // 5. Menu Items (all clean 18 items + placeholder items with is_placeholder flag)
  const menuRes = await pool.query("SELECT id, sort_order, path, icon, text, plan, required_role, type, is_placeholder FROM menu_items ORDER BY sort_order ASC, text ASC");
  out += generateInserts("menu_items", menuRes.rows, "ON CONFLICT (id) DO UPDATE SET sort_order = EXCLUDED.sort_order, text = EXCLUDED.text, path = EXCLUDED.path, is_placeholder = EXCLUDED.is_placeholder");

  // 6. Role Menu Items
  const rmiRes = await pool.query("SELECT role_id, menu_item_id FROM role_menu_items");
  out += generateInserts("role_menu_items", rmiRes.rows, "ON CONFLICT DO NOTHING");

  // 7. Common Module Configs (gym_id IS NULL)
  const modConfigsRes = await pool.query("SELECT id, gym_id, module_id, module_name, category, path, is_enabled, plan_tier, created_at, updated_at FROM gym_module_configs WHERE gym_id IS NULL");
  out += generateInserts("gym_module_configs", modConfigsRes.rows, "ON CONFLICT (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), module_id) DO NOTHING");

  // 8. Common Role Permissions (gym_id IS NULL)
  const rolePermsRes = await pool.query("SELECT id, gym_id, role_id, permission_key, is_allowed, created_at, updated_at FROM gym_role_permissions WHERE gym_id IS NULL");
  out += generateInserts("gym_role_permissions", rolePermsRes.rows, "ON CONFLICT (COALESCE(gym_id, '00000000-0000-0000-0000-000000000000'), role_id, permission_key) DO NOTHING");

  out += `-- ==========================================================================\n`;
  out += `-- PART 3: LOGIN USERS ALONE (AUTHENTICATION CREDENTIALS)\n`;
  out += `-- ==========================================================================\n\n`;

  // 9. Core Login Users
  // Select System Admin, Super Admins, and branch staff with bcrypt hashes
  const usersRes = await pool.query(`
    SELECT u.id, u.gym_id, u.branch_id, u.role_id, u.full_name, u.email, u.phone, u.password_hash, u.is_active, u.created_at, u.updated_at
    FROM users u
    WHERE u.email IN (
      'admin@gym.com',
      'jpsmart27@gmail.com',
      'naveenprakash178@gmail.com',
      'test@gym.com'
    )
  `);

  out += generateInserts("users", usersRes.rows, "ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = EXCLUDED.is_active");

  // 10. Sample branch staff credentials for Test Gym 1 (Admin, Front Desk, Trainer, Accountant)
  // Ensure every role has a ready-to-test login account using the standard test hash ($2b$10$4eN9nE2v93LqQ3wY4dJ8e.e71n9eH3r5k0J7bY4f0u3Y4dJ8e.e71 or standard password hash)
  const sysAdminHash = usersRes.rows.find(u => u.email === 'admin@gym.com')?.password_hash || '$2b$12$5pTbqoOIeMvX3q4c1yKqVuL6Xl7K6c0b5R3a0z7pQ9y7K6c0b5R3a';
  const roleMapRes = await pool.query("SELECT id, name FROM roles");
  const roleMap = {};
  for (const r of roleMapRes.rows) roleMap[r.name] = r.id;

  const sampleStaff = [
    {
      id: "70000000-0000-0000-0000-000000000001",
      gym_id: "6ecfc033-52f1-444f-a3f6-65fdd664c988",
      branch_id: "2b0c6048-dbf6-4dae-b831-48111246603e",
      role_id: roleMap["admin"],
      full_name: "Branch Administrator",
      email: "admin@fitzone.com",
      phone: "9876500001",
      password_hash: sysAdminHash,
      is_active: true
    },
    {
      id: "70000000-0000-0000-0000-000000000002",
      gym_id: "6ecfc033-52f1-444f-a3f6-65fdd664c988",
      branch_id: "2b0c6048-dbf6-4dae-b831-48111246603e",
      role_id: roleMap["front-desk"],
      full_name: "Front Desk Staff",
      email: "frontdesk@fitzone.com",
      phone: "9876500002",
      password_hash: sysAdminHash,
      is_active: true
    },
    {
      id: "70000000-0000-0000-0000-000000000003",
      gym_id: "6ecfc033-52f1-444f-a3f6-65fdd664c988",
      branch_id: "2b0c6048-dbf6-4dae-b831-48111246603e",
      role_id: roleMap["trainer"],
      full_name: "Head Trainer",
      email: "trainer@fitzone.com",
      phone: "9876500003",
      password_hash: sysAdminHash,
      is_active: true
    },
    {
      id: "70000000-0000-0000-0000-000000000004",
      gym_id: "6ecfc033-52f1-444f-a3f6-65fdd664c988",
      branch_id: "2b0c6048-dbf6-4dae-b831-48111246603e",
      role_id: roleMap["accountant"],
      full_name: "Chief Accountant",
      email: "accountant@fitzone.com",
      phone: "9876500004",
      password_hash: sysAdminHash,
      is_active: true
    }
  ];

  out += generateInserts("users", sampleStaff, "ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash");

  // Target file path
  const targetPath = "c:\\Users\\navee\\Documents\\GitHub\\Gym_Overview\\db\\db_run_live.sql";
  fs.writeFileSync(targetPath, out, "utf8");

  console.log(`✓ Successfully written complete live SQL script to: ${targetPath}`);
  console.log(`Total characters: ${out.length}, Lines: ${out.split("\n").length}`);

  pool.end();
}

main().catch((err) => {
  console.error("Generator failed:", err);
  pool.end();
});
