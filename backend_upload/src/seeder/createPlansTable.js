require("dotenv").config();
const pool = require("../config/db");

const createPlansTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        duration_months INTEGER NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(query);
    console.log("Plans table created successfully.");
  } catch (error) {
    console.error("Error creating plans table:", error);
  } finally {
    pool.end();
  }
};

createPlansTable();
