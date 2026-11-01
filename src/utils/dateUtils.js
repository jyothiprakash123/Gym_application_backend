/**
 * Date utility functions for FitZone Gym SaaS
 * Provides accurate calendar-based duration calculations and timezone-safe date parsing.
 */

/**
 * Format a Date object or string as local YYYY-MM-DD
 * @param {Date|string} dateInput 
 * @returns {string} YYYY-MM-DD
 */
const formatLocalDate = (dateInput) => {
  if (!dateInput) return "";
  if (typeof dateInput === "string") {
    // If already in YYYY-MM-DD format (or starts with it)
    const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Parse YYYY-MM-DD string into a local Date object at 00:00:00
 * @param {string} str 
 * @returns {Date}
 */
const parseLocalDate = (str) => {
  if (!str) return new Date();
  const cleanStr = String(str).split("T")[0];
  const parts = cleanStr.split("-").map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date(str);
};

/**
 * Returns today's date formatted as local YYYY-MM-DD
 * @returns {string}
 */
const getTodayDateStr = () => {
  return formatLocalDate(new Date());
};

/**
 * Returns the day after dateInput as local YYYY-MM-DD
 * @param {string|Date} dateInput 
 * @returns {string}
 */
const getNextDayStr = (dateInput) => {
  if (!dateInput) return "";
  const d = parseLocalDate(dateInput);
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + 1);
  return formatLocalDate(d);
};

/**
 * Calculate the membership end date based on plan duration (months vs days)
 * Correctly handles calendar months (monthly, quarterly, half-yearly, yearly)
 * and custom day durations with inclusive calendar boundaries.
 * 
 * @param {string|Date} startDateInput 
 * @param {number|string} durationDays 
 * @param {string} planName 
 * @returns {string} YYYY-MM-DD
 */
const calculatePlanEndDate = (startDateInput, durationDays, planName = "") => {
  if (!startDateInput) return null;
  const startDateStr = formatLocalDate(startDateInput);
  if (!startDateStr) return null;

  const [sYear, sMonth, sDay] = startDateStr.split("-").map(Number);
  const start = new Date(sYear, sMonth - 1, sDay);
  if (isNaN(start.getTime())) return null;

  const numDays = parseInt(durationDays, 10) || 30;
  const name = String(planName || "").toLowerCase();

  // Determine calendar months if applicable
  let months = null;
  if (/\b1\s*year\b|\byearly\b|\bannual\b/i.test(name) || numDays === 365 || numDays === 366) {
    months = 12;
  } else if (/\b6\s*month|\bhalf[\s-]yearly\b|\bsemi[\s-]annual\b/i.test(name) || (numDays >= 180 && numDays <= 184)) {
    months = 6;
  } else if (/\b3\s*month|\bquarterly\b|\bquarter\b/i.test(name) || (numDays >= 90 && numDays <= 92)) {
    months = 3;
  } else if (/\b1\s*month|\bmonthly\b/i.test(name) || (numDays >= 28 && numDays <= 31)) {
    months = 1;
  } else {
    const monthMatch = name.match(/\b(\d+)\s*month/i);
    if (monthMatch) {
      months = parseInt(monthMatch[1], 10);
    }
  }

  let end;
  if (months !== null && months > 0) {
    const daysInStartMonth = new Date(sYear, sMonth, 0).getDate();
    const isLastDayOfStartMonth = (sDay === daysInStartMonth);

    const targetMonthIdx = (sMonth - 1) + months;
    const targetYear = sYear + Math.floor(targetMonthIdx / 12);
    const normalizedTargetMonth = ((targetMonthIdx % 12) + 12) % 12;

    const daysInTargetMonth = new Date(targetYear, normalizedTargetMonth + 1, 0).getDate();

    if (isLastDayOfStartMonth) {
      // If plan starts on last day of month, end date is last day of target month (e.g. Jan 31 -> Feb 28)
      end = new Date(targetYear, normalizedTargetMonth, daysInTargetMonth);
    } else {
      const targetDay = Math.min(sDay, daysInTargetMonth);
      const nextCycleStart = new Date(targetYear, normalizedTargetMonth, targetDay);
      end = new Date(nextCycleStart);
      end.setDate(end.getDate() - 1);
    }
  } else {
    // Custom day duration: start date + numDays - 1 day (inclusive)
    end = new Date(start);
    end.setDate(start.getDate() + numDays - 1);
  }

  return formatLocalDate(end);
};

/**
 * Calculate difference in calendar days between today and target date.
 * Positive = expired X days ago, 0 = today, negative = X days in future.
 */
const getExpiryDiffDays = (dateInput) => {
  if (!dateInput) return 0;
  const exp = parseLocalDate(dateInput);
  exp.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffTime = now.getTime() - exp.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
};

const getDaysRemaining = (dateInput) => {
  if (!dateInput) return null;
  return -getExpiryDiffDays(dateInput);
};

module.exports = {
  formatLocalDate,
  toLocalDateStr: formatLocalDate,
  parseLocalDate,
  getTodayDateStr,
  getNextDayStr,
  calculatePlanEndDate,
  getExpiryDiffDays,
  getDaysRemaining,
};
