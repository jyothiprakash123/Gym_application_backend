const pool = require("../config/db");

/**
 * GET /api/locations/countries
 * Returns all active countries (India prioritized first, then alphabetical).
 */
const getCountries = async (req, res, next) => {
  try {
    const result = await pool.query(
      `
      SELECT id, name, code, phone_code
      FROM countries
      WHERE is_active = true
      ORDER BY CASE WHEN code = 'IN' THEN 0 ELSE 1 END, name ASC
      `
    );

    return res.status(200).json({
      success: true,
      data: {
        countries: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/locations/states
 * Returns active states filtered by countryId, countryCode, or countryName.
 */
const getStates = async (req, res, next) => {
  try {
    const { countryId, countryCode, countryName } = req.query;

    let query = `
      SELECT s.id, s.country_id, s.name, s.code
      FROM states s
      JOIN countries c ON c.id = s.country_id
      WHERE s.is_active = true AND c.is_active = true
    `;
    const params = [];

    if (countryId) {
      params.push(countryId);
      query += ` AND s.country_id = $${params.length}`;
    } else if (countryCode) {
      params.push(String(countryCode).trim().toUpperCase());
      query += ` AND UPPER(c.code) = $${params.length}`;
    } else if (countryName) {
      params.push(String(countryName).trim());
      query += ` AND LOWER(c.name) = LOWER($${params.length})`;
    }

    query += ` ORDER BY s.name ASC`;

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      data: {
        states: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCountries,
  getStates,
};
