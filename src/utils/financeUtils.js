/**
 * ============================================================================
 * Financial Validation and Formatting Utilities (Backend)
 * ============================================================================
 * Ensures consistent money validation across the application:
 * - Numbers with at most 2 decimal places
 * - No negative values
 * - Sane maximum (default ₹1,00,00,000 / 1 Crore)
 * - Consistent formatting as Indian Rupees (en-IN)
 */

const MAX_MONEY_AMOUNT = 10000000; // ₹1 Crore
const DECIMAL_REGEX = /^-?\d+(\.\d+)?$/;

/**
 * Validates a monetary value according to standard finance rules:
 * 1. Must not be null, undefined, or empty string.
 * 2. Must be a finite number.
 * 3. Cannot be negative.
 * 4. Must not exceed maximum sane amount (1 Crore).
 * 5. Must have at most 2 decimal places.
 * 6. Minimum constraint check (> 0 for transactions, >= 0 for prices/fees).
 *
 * @param {any} value - The input value to validate
 * @param {Object} options - Validation constraints
 * @param {string} [options.fieldName="Amount"] - Human-readable field label
 * @param {boolean} [options.allowZero=false] - Whether zero is allowed (e.g. for free plans)
 * @param {number} [options.min=0.01] - Minimum allowed value
 * @param {number} [options.max=MAX_MONEY_AMOUNT] - Maximum allowed value
 * @returns {{ isValid: boolean, error?: string, parsedAmount?: number }}
 */
function validateMoney(value, options = {}) {
  const {
    fieldName = "Amount",
    allowZero = false,
    min = allowZero ? 0 : 0.01,
    max = MAX_MONEY_AMOUNT,
  } = options;

  if (value === undefined || value === null || String(value).trim() === "") {
    return {
      isValid: false,
      error: `${fieldName} is required`,
    };
  }

  const strVal = String(value).trim();

  // Check valid numeric format
  if (!DECIMAL_REGEX.test(strVal)) {
    return {
      isValid: false,
      error: `${fieldName} must be a valid numeric amount`,
    };
  }

  const numVal = Number(strVal);

  if (isNaN(numVal) || !isFinite(numVal)) {
    return {
      isValid: false,
      error: `${fieldName} must be a valid number`,
    };
  }

  if (numVal < 0) {
    return {
      isValid: false,
      error: `${fieldName} cannot be negative`,
    };
  }

  if (!allowZero && numVal <= 0) {
    return {
      isValid: false,
      error: `${fieldName} must be greater than 0`,
    };
  }

  if (numVal < min) {
    return {
      isValid: false,
      error: `${fieldName} must be at least ₹${min}`,
    };
  }

  if (numVal > max) {
    return {
      isValid: false,
      error: `${fieldName} cannot exceed ₹${max.toLocaleString("en-IN")}`,
    };
  }

  // Check decimal places (max 2 decimals allowed)
  if (strVal.includes(".")) {
    const decimalParts = strVal.split(".");
    if (decimalParts[1] && decimalParts[1].length > 2) {
      return {
        isValid: false,
        error: `${fieldName} cannot have more than 2 decimal places`,
      };
    }
  }

  // Sane rounded precision to 2 decimal places
  const parsedAmount = Math.round(numVal * 100) / 100;

  return {
    isValid: true,
    parsedAmount,
  };
}

/**
 * Formats a numeric value into standardized Indian Rupees (en-IN).
 * e.g. 150000.5 -> "₹1,50,000.50"
 *
 * @param {number} amount
 * @param {boolean} [includeSymbol=true]
 * @returns {string}
 */
function formatINR(amount, includeSymbol = true) {
  const num = Number(amount) || 0;
  if (!includeSymbol) {
    return num.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

module.exports = {
  MAX_MONEY_AMOUNT,
  validateMoney,
  formatINR,
};

