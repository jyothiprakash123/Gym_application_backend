/**
 * passwordPolicy.js
 * Enforces production password complexity rules.
 */

const validatePasswordStrength = (password) => {
  if (!password || typeof password !== "string") {
    return {
      isValid: false,
      error: "Password is required",
    };
  }

  if (password.length < 8) {
    return {
      isValid: false,
      error: "Password must be at least 8 characters long",
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one uppercase letter (A-Z)",
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one lowercase letter (a-z)",
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one number (0-9)",
    };
  }

  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one special character (!@#$%^&*)",
    };
  }

  return {
    isValid: true,
    error: null,
  };
};

module.exports = {
  validatePasswordStrength,
};

