const pool = require("../config/db");

// ======================================================
// GET SETTINGS
// ======================================================

const getSettings = async (req, res, next) => {
  try {
    const gymId = req.query.gymId || null;

    let query = `
      SELECT id, gym_id, key, value, updated_at
      FROM settings
    `;
    const params = [];

    if (gymId) {
      query += ` WHERE gym_id = $1`;
      params.push(gymId);
    } else {
      query += ` WHERE gym_id IS NULL`;
    }

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      data: {
        settings: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ======================================================
// UPSERT SETTING
// ======================================================

const upsertSetting = async (req, res, next) => {
  try {
    const { gymId, key, value } = req.body;

    if (!key) {
      return res.status(400).json({
        success: false,
        message: "Key is required",
      });
    }

    // Check if it exists
    let existQuery = `SELECT id FROM settings WHERE key = $1`;
    const existParams = [key];

    if (gymId) {
      existQuery += ` AND gym_id = $2`;
      existParams.push(gymId);
    } else {
      existQuery += ` AND gym_id IS NULL`;
    }

    const existResult = await pool.query(existQuery, existParams);

    let result;

    if (existResult.rows.length > 0) {
      // Update
      const id = existResult.rows[0].id;
      result = await pool.query(
        `
        UPDATE settings
        SET value = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, gym_id, key, value, updated_at
        `,
        [value, id]
      );
    } else {
      // Insert
      result = await pool.query(
        `
        INSERT INTO settings (gym_id, key, value)
        VALUES ($1, $2, $3)
        RETURNING id, gym_id, key, value, updated_at
        `,
        [gymId || null, key, value]
      );
    }

    return res.status(200).json({
      success: true,
      message: "Setting updated successfully",
      data: {
        setting: result.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSettings,
  upsertSetting,
};
