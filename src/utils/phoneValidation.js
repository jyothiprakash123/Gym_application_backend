/**
 * Shared phone utility for FitZone Gym Backend
 * Complies with Indian mobile number standards (10 digits starting 6-9)
 */

/**
 * Sanitizes phone input: strips all non-digit characters and caps at 10 digits.
 * @param {string|number} value
 * @returns {string} 0-10 digit string
 */
const sanitizePhone = (value) => {
  if (!value) return "";
  let digits = String(value).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
};

/**
 * Validates Indian mobile numbers: exactly 10 digits starting with 6, 7, 8, or 9.
 * @param {string|number} value
 * @returns {boolean}
 */
const isValidPhone = (value) => {
  if (!value) return false;
  const cleaned = String(value).replace(/\D/g, "");
  return /^[6-9]\d{9}$/.test(cleaned);
};

module.exports = {
  sanitizePhone,
  isValidPhone,
};
