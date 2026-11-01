const pool = require("../config/db");

/**
 * Sweeps and marks overdue memberships as expired.
 * A membership is expired if its end_date is strictly before CURRENT_DATE.
 * 
 * @returns {Promise<number>} Number of memberships updated to 'expired'
 */
const expireOverdueMemberships = async () => {
  try {
    const res = await pool.query(
      `UPDATE member_memberships 
       SET status = 'expired', updated_at = NOW() 
       WHERE status = 'active' AND end_date < CURRENT_DATE`
    );
    if (res.rowCount > 0) {
      console.log(`[Auto-Expire] Marked ${res.rowCount} overdue membership(s) as 'expired'`);
    }
    return res.rowCount;
  } catch (err) {
    console.error("[Auto-Expire] Error expiring overdue memberships:", err);
    return 0;
  }
};

/**
 * Automatically resumes frozen memberships whose freeze_end has passed.
 * 
 * @returns {Promise<number>} Number of memberships resumed
 */
const resumeExpiredFreezes = async () => {
  try {
    const res = await pool.query(
      `UPDATE member_memberships 
       SET 
         status = CASE WHEN (end_date + GREATEST(1, freeze_end - freeze_start)) < CURRENT_DATE THEN 'expired' ELSE 'active' END,
         end_date = end_date + GREATEST(1, freeze_end - freeze_start),
         updated_at = NOW() 
       WHERE status = 'on_hold' AND freeze_end < CURRENT_DATE`
    );
    if (res.rowCount > 0) {
      console.log(`[Auto-Expire] Resumed ${res.rowCount} frozen membership(s) whose freeze period ended`);
    }
    return res.rowCount;
  } catch (err) {
    console.error("[Auto-Expire] Error resuming expired freezes:", err);
    return 0;
  }
};

/**
 * Initializes recurring background sweep for auto-expiry.
 * Runs immediately on startup and every hour.
 * 
 * @returns {NodeJS.Timeout} Interval object (unref'd)
 */
const initAutoExpireJob = () => {
  // Run sweep on startup
  expireOverdueMemberships();
  resumeExpiredFreezes();

  // Run recurring hourly sweep (every 3600 seconds)
  const interval = setInterval(async () => {
    await expireOverdueMemberships();
    await resumeExpiredFreezes();
  }, 60 * 60 * 1000);

  // Unref so this background interval doesn't prevent clean Node.js process exit during tests
  if (interval.unref) {
    interval.unref();
  }

  return interval;
};

module.exports = {
  expireOverdueMemberships,
  resumeExpiredFreezes,
  initAutoExpireJob,
};
