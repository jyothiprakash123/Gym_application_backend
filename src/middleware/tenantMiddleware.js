const pool = require("../config/db");

/**
 * Resolves and attaches tenant context to req.tenant.
 * 
 * Rules:
 * 1. If req.user.role_name === 'system-admin':
 *    - Allowed to optionally target a gym via req.query, req.body, or req.params.
 *    - If omitted, tenant.gymId is null (unrestricted global access).
 * 2. If req.user.role_name !== 'system-admin':
 *    - tenant.gymId is ALWAYS forced to req.user.gym_id.
 *    - Any client-supplied gymId / gym_id in query, body, or params is overwritten.
 *    - If user has no gym_id, access is denied (403).
 */
const resolveTenant = (req) => {
  if (!req.user) {
    return null;
  }

  const isSystemAdmin = req.user.role_name === "system-admin";
  let effectiveGymId = null;

  if (isSystemAdmin) {
    // System admin can optionally supply a gymId filter
    effectiveGymId =
      req.query?.gymId ||
      req.query?.gym_id ||
      req.body?.gymId ||
      req.body?.gym_id ||
      req.params?.gymId ||
      req.params?.gym_id ||
      null;
  } else {
    // Non-system-admin is strictly locked to their assigned gym_id
    effectiveGymId = req.user.gym_id || null;

    // Sanitization: Overwrite any client-supplied gymId to prevent downstream leaks
    if (req.query) {
      if (req.query.gymId) req.query.gymId = effectiveGymId;
      if (req.query.gym_id) req.query.gym_id = effectiveGymId;
    }
    if (req.body && typeof req.body === "object") {
      if (req.body.gymId !== undefined) req.body.gymId = effectiveGymId;
      if (req.body.gym_id !== undefined) req.body.gym_id = effectiveGymId;
    }
  }

  // Branch scoping
  let effectiveBranchId = req.user.branch_id || null;
  if (!effectiveBranchId) {
    effectiveBranchId =
      req.query?.branchId ||
      req.query?.branch_id ||
      req.body?.branchId ||
      req.body?.branch_id ||
      req.params?.branchId ||
      req.params?.branch_id ||
      null;
  } else {
    // If user has a fixed branch_id, sanitize query filters to avoid spoofing in listings
    if (req.query) {
      if (req.query.branchId) req.query.branchId = effectiveBranchId;
      if (req.query.branch_id) req.query.branch_id = effectiveBranchId;
    }
  }

  return {
    gymId: effectiveGymId,
    branchId: effectiveBranchId,
    isSystemAdmin,
    roleName: req.user.role_name,
    userId: req.user.id,

    /**
     * Reusable SQL condition builder for gym isolation.
     * Appends gymId to the given params array and returns the parameterized SQL fragment.
     *
     * @param {string} gymColumn - SQL column (e.g. 'b.gym_id' or 'g.id')
     * @param {Array} paramsArray - SQL parameters array (e.g. countParams or dataParams)
     * @returns {string} - SQL clause (e.g. "b.gym_id = $3" or "1=1" if system-admin with no gym specified)
     */
    sqlCondition(gymColumn, paramsArray) {
      if (!effectiveGymId) {
        return "1=1";
      }
      paramsArray.push(effectiveGymId);
      return `${gymColumn} = $${paramsArray.length}`;
    },
  };
};

/**
 * Shared branch-access helper (Day 2 Prompt 2).
 * Replaces fragile b.manager_id = $1 checks.
 *
 * Rules:
 * - system-admin: all branches (unless explicit filter)
 * - super-admin: branches where gym_id = req.user.gym_id (all branches of gym, unless explicit branchId filter)
 * - admin / front-desk / staff:
 *     their req.user.branch_id (if assigned)
 *     fall back to gym_id (all branches in gym) if no branch is assigned
 *
 * @param {object} req - Express request
 * @returns {{
 *   type: 'ALL' | 'GYM' | 'BRANCH',
 *   branchId: string | null,
 *   gymId: string | null,
 *   isRestricted: boolean
 * }}
 */
const resolveBranchAccess = (req) => {
  if (!req.user) {
    return { type: "NONE", branchId: null, gymId: null, isRestricted: true };
  }

  const role = req.user.role_name;
  const userGymId = req.user.gym_id || req.tenant?.gymId || null;
  const userBranchId = req.user.branch_id || null;

  // 1. system-admin: all branches
  if (role === "system-admin" || req.tenant?.isSystemAdmin) {
    const filterBranch = req.query?.branchId || req.body?.branchId || req.params?.branchId || null;
    const filterGym = req.query?.gymId || req.body?.gymId || req.params?.gymId || null;
    if (filterBranch) {
      return { type: "BRANCH", branchId: filterBranch, gymId: filterGym, isRestricted: true };
    }
    if (filterGym) {
      return { type: "GYM", branchId: null, gymId: filterGym, isRestricted: false };
    }
    return { type: "ALL", branchId: null, gymId: null, isRestricted: false };
  }

  // 2. super-admin: branches where gym_id = req.user.gym_id
  if (role === "super-admin") {
    const filterBranch = req.query?.branchId || req.body?.branchId || req.params?.branchId || null;
    if (filterBranch) {
      return { type: "BRANCH", branchId: filterBranch, gymId: userGymId, isRestricted: true };
    }
    return { type: "GYM", branchId: null, gymId: userGymId, isRestricted: false };
  }

  // 3. admin / front-desk / staff:
  // If user has branch_id assigned: strictly locked to their branch_id
  if (userBranchId) {
    return { type: "BRANCH", branchId: userBranchId, gymId: userGymId, isRestricted: true };
  }

  // Fall back to gym_id if no branch assigned
  const filterBranch = req.query?.branchId || req.body?.branchId || req.params?.branchId || null;
  if (filterBranch) {
    return { type: "BRANCH", branchId: filterBranch, gymId: userGymId, isRestricted: true };
  }

  return { type: "GYM", branchId: null, gymId: userGymId, isRestricted: false };
};

/**
 * Checks whether the current user is authorized to access / manage a specific branch record.
 * Replaces fragile branch.manager_id === user.id checks.
 *
 * @param {object} user - req.user
 * @param {object} branch - branch record from DB ({ id, gym_id })
 * @returns {boolean}
 */
const canUserAccessBranch = (user, branch) => {
  if (!user || !branch) return false;
  if (user.role_name === "system-admin") return true;
  if (user.gym_id !== branch.gym_id) return false;
  if (user.role_name === "super-admin") return true;

  // admin / front-desk
  if (user.branch_id) {
    return user.branch_id === branch.id;
  }
  // Fall back to gym_id if user has no specific branch assigned
  return true;
};

/**
 * Tenant scoping Express middleware.
 * Can be used explicitly in route pipelines.
 */
const tenantMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required before tenant resolution",
    });
  }

  if (req.user.role_name !== "system-admin" && !req.user.gym_id) {
    return res.status(403).json({
      success: false,
      message: "Access denied: Account is not associated with any gym",
    });
  }

  req.tenant = resolveTenant(req);
  next();
};

/**
 * Verifies that a specific record belongs to the active tenant's gym.
 * For single-record operations (getById, update, delete).
 *
 * @param {object} poolOrClient - pg pool or client
 * @param {object} options
 * @param {string} options.tableName - e.g. 'members', 'payments', 'branches'
 * @param {string} options.recordId - UUID of the record
 * @param {object} options.tenant - req.tenant object
 * @param {string} [options.branchColumn='branch_id'] - name of branch_id column if applicable
 * @returns {Promise<{ found: boolean, record: object | null }>}
 */
const assertRecordBelongsToTenant = async (
  poolOrClient,
  { tableName, recordId, tenant, branchColumn = "branch_id" }
) => {
  if (!recordId) return { found: false, record: null };

  // If system-admin and no target gym is selected, any existing record is accessible
  if (tenant.isSystemAdmin && !tenant.gymId) {
    const res = await poolOrClient.query(
      `SELECT * FROM ${tableName} WHERE id = $1 LIMIT 1`,
      [recordId]
    );
    return { found: res.rows.length > 0, record: res.rows[0] || null };
  }

  // If table directly has gym_id (e.g. gyms, or tables with direct gym_id)
  if (tableName === "gyms") {
    const res = await poolOrClient.query(
      `SELECT * FROM gyms WHERE id = $1 AND id = $2 LIMIT 1`,
      [recordId, tenant.gymId]
    );
    return { found: res.rows.length > 0, record: res.rows[0] || null };
  }

  if (tableName === "branches") {
    const res = await poolOrClient.query(
      `SELECT * FROM branches WHERE id = $1 AND gym_id = $2 LIMIT 1`,
      [recordId, tenant.gymId]
    );
    return { found: res.rows.length > 0, record: res.rows[0] || null };
  }

  // For tables linked via branches (members, payments, membership_plans, staff, attendance, leads, expenses)
  const res = await poolOrClient.query(
    `SELECT t.*, b.gym_id 
     FROM ${tableName} t
     JOIN branches b ON b.id = t.${branchColumn}
     WHERE t.id = $1 AND b.gym_id = $2
     LIMIT 1`,
    [recordId, tenant.gymId]
  );

  return { found: res.rows.length > 0, record: res.rows[0] || null };
};

/**
 * Verifies that a branchId belongs to the tenant's gym.
 *
 * @param {object} poolOrClient - pg pool or client
 * @param {string} branchId - UUID of the branch
 * @param {object} tenant - req.tenant object
 * @returns {Promise<boolean>}
 */
const assertBranchBelongsToTenant = async (poolOrClient, branchId, tenant) => {
  if (!branchId) return false;
  if (tenant.isSystemAdmin && !tenant.gymId) {
    const res = await poolOrClient.query(
      `SELECT id FROM branches WHERE id = $1 LIMIT 1`,
      [branchId]
    );
    return res.rows.length > 0;
  }

  const res = await poolOrClient.query(
    `SELECT id FROM branches WHERE id = $1 AND gym_id = $2 LIMIT 1`,
    [branchId, tenant.gymId]
  );
  return res.rows.length > 0;
};

module.exports = {
  tenantMiddleware,
  resolveTenant,
  resolveBranchAccess,
  canUserAccessBranch,
  assertRecordBelongsToTenant,
  assertBranchBelongsToTenant,
};
