/**
 * cookieConfig.js
 * Centralized Cookie Configuration for FitZone Gym SaaS
 *
 * Supports cross-site deployment (e.g., Vercel frontend on *.vercel.app
 * and Render/Railway backend on *.onrender.com or *.railway.app).
 *
 * Key Browser Security & Cross-Site Rules:
 * 1. SameSite='none': Required for cross-site requests when frontend and backend
 *    are hosted on different domains/subdomains.
 * 2. Secure=true: Modern browsers (Chrome, Safari, Firefox, Edge) REJECT any
 *    cookie with SameSite='none' unless Secure is true (served over HTTPS).
 * 3. httpOnly=true: Strictly blocks client-side JavaScript access (document.cookie),
 *    protecting auth tokens from XSS theft.
 * 4. path='/': Ensures cookies are transmitted across all API endpoints.
 */

/**
 * Computes base cookie options according to environment configuration.
 *
 * @returns {object} Base cookie options
 */
const getBaseCookieOptions = () => {
  const isProd = process.env.NODE_ENV === "production";
  const cookieDomain = process.env.COOKIE_DOMAIN
    ? process.env.COOKIE_DOMAIN.trim()
    : "";

  // Determine sameSite setting:
  // - If COOKIE_SAMESITE is explicitly set, respect it.
  // - If COOKIE_DOMAIN is set in production (e.g. .flezora.com for app.flezora.com & api.flezora.com),
  //   default to "lax" so iOS WebKit ITP treats cookies as strictly first-party.
  // - Otherwise in production cross-site deployments, default to "none".
  // - In development (localhost HTTP), default to "lax".
  const defaultSameSite = isProd ? (cookieDomain ? "lax" : "none") : "lax";
  let sameSite = (process.env.COOKIE_SAMESITE || defaultSameSite).toLowerCase();

  // Validate sameSite value
  if (!["none", "lax", "strict"].includes(sameSite)) {
    sameSite = defaultSameSite;
  }

  // Determine secure setting:
  let secure;
  if (process.env.COOKIE_SECURE !== undefined) {
    secure =
      process.env.COOKIE_SECURE === "true" ||
      process.env.COOKIE_SECURE === "1";
  } else {
    // In production, default to true. Also, if sameSite is "none", it MUST be secure.
    secure = isProd || sameSite === "none";
  }

  // Mandatory browser RFC compliance: SameSite=None REQUIRES Secure=true
  if (sameSite === "none" && !secure) {
    console.warn(
      "[CookieConfig] Warning: SameSite=None requires Secure=true in modern browsers. Enforcing Secure=true."
    );
    secure = true;
  }

  const options = {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  };

  // Set shared parent domain when frontend & backend share a root domain (e.g. .flezora.com)
  if (cookieDomain) {
    options.domain = cookieDomain;
  }

  return options;
};

/**
 * Cookie options for Refresh Token (Long-lived: 7 days)
 */
const getRefreshCookieOptions = () => {
  return {
    ...getBaseCookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  };
};

/**
 * Cookie options for Access Token (Short-lived: 15 minutes)
 */
const getAccessCookieOptions = () => {
  return {
    ...getBaseCookieOptions(),
    maxAge: 15 * 60 * 1000, // 15 minutes in milliseconds
  };
};

/**
 * Cookie options for clearing cookies on logout.
 * In Express, attributes (path, domain, secure, sameSite) MUST match the
 * options used when setting the cookie, otherwise the browser will not delete it.
 */
const getClearCookieOptions = () => {
  return {
    ...getBaseCookieOptions(),
  };
};

module.exports = {
  getBaseCookieOptions,
  getRefreshCookieOptions,
  getAccessCookieOptions,
  getClearCookieOptions,
};
