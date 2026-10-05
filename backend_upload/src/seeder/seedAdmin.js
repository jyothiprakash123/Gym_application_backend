require("dotenv").config();

const bcrypt = require("bcryptjs");
const pool = require("../config/db");

const seedAdmin = async () => {
  try {
    console.log("Starting admin seed...");

    // ======================================================
    // 1. Create / get Super Admin role
    // ======================================================

    const roleResult = await pool.query(
      `
      INSERT INTO roles (
        name,
        description
      )
      VALUES ($1, $2)
      ON CONFLICT (name)
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name
      `,
      [
        "super-admin",
        "System administrator",
      ]
    );

    const role = roleResult.rows[0];

    console.log("Role:", role.name);

    // ======================================================
    // 2. Check if admin already exists
    // ======================================================

    const existingUser = await pool.query(
      `
      SELECT id, email
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      ["admin@gym.com"]
    );

    if (existingUser.rows.length > 0) {
      console.log(
        "Admin already exists:",
        existingUser.rows[0].email
      );

      await pool.end();
      return;
    }

    // ======================================================
    // 3. Hash password
    // ======================================================

    const passwordHash = await bcrypt.hash(
      "Admin@123",
      12
    );

    // ======================================================
    // 4. Create admin user
    // ======================================================

    const userResult = await pool.query(
      `
      INSERT INTO users (
        email,
        password_hash,
        full_name,
        phone,
        role_id,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        email,
        full_name,
        role_id,
        is_active
      `,
      [
        "admin@gym.com",
        passwordHash,
        "Super Admin",
        "9999999999",
        role.id,
        true,
      ]
    );

    console.log(
      "Admin created successfully:"
    );

    console.table(userResult.rows[0]);

    console.log("");
    console.log("Login credentials:");
    console.log("Email    : admin@gym.com");
    console.log("Password : Admin@123");

    await pool.end();

  } catch (error) {
    console.error(
      "Failed to seed admin:",
      error
    );

    await pool.end();

    process.exit(1);
  }
};

seedAdmin();