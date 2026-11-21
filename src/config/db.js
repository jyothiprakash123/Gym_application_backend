const { Pool, types } = require("pg");

// Return PostgreSQL DATE (OID 1082) as 'YYYY-MM-DD' string to avoid timezone shifting
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("connect", () => {
  console.log("PostgreSQL connected");
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error);
});

module.exports = pool;