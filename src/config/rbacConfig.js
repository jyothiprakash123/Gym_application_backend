/**
 * ============================================================================
 * Central RBAC (Role-Based Access Control) Matrix Configuration
 * ============================================================================
 * Defines allowed actions (view, create, edit, delete) per module per role.
 *
 * Modules:
 * - members
 * - plans
 * - payments
 * - attendance
 * - staff
 * - leads
 * - expenses
 * - branches
 * - settings
 * - gyms
 * - dashboard
 *
 * Roles:
 * - system-admin : Platform owner (unrestricted global access)
 * - super-admin  : Gym business owner (full access within their gym)
 * - admin        : Branch manager / operational admin (scoped to branch/gym)
 * - front-desk   : Desk executive / receptionist (operational front-office tasks)
 * - trainer      : Gym trainer (assigned members, workout, attendance check-in)
 * - accountant   : Finance clerk (payments, expenses, invoices)
 */

const PERMISSION_MATRIX = {
  "system-admin": {
    members:    { view: true, create: true, edit: true, delete: true },
    plans:      { view: true, create: true, edit: true, delete: true },
    payments:   { view: true, create: true, edit: true, delete: true },
    invoices:   { view: true, create: true, edit: true, delete: true },
    attendance: { view: true, create: true, edit: true, delete: true },
    staff:      { view: true, create: true, edit: true, delete: true },
    leads:      { view: true, create: true, edit: true, delete: true },
    expenses:   { view: true, create: true, edit: true, delete: true },
    branches:   { view: true, create: true, edit: true, delete: true },
    settings:   { view: true, create: true, edit: true, delete: true },
    gyms:       { view: true, create: true, edit: true, delete: true },
    dashboard:  { view: true, create: false, edit: false, delete: false },
  },

  "super-admin": {
    members:    { view: true, create: true, edit: true, delete: true },
    plans:      { view: true, create: true, edit: true, delete: true },
    payments:   { view: true, create: true, edit: true, delete: true },
    invoices:   { view: true, create: true, edit: true, delete: true },
    attendance: { view: true, create: true, edit: true, delete: true },
    staff:      { view: true, create: true, edit: true, delete: true },
    leads:      { view: true, create: true, edit: true, delete: true },
    expenses:   { view: true, create: true, edit: true, delete: true },
    branches:   { view: true, create: true, edit: true, delete: true },
    settings:   { view: true, create: true, edit: true, delete: false }, // Cannot delete platform master settings
    gyms:       { view: true, create: false, edit: true, delete: false }, // Can edit gym profile, cannot delete gym
    dashboard:  { view: true, create: false, edit: false, delete: false },
  },

  "admin": {
    members:    { view: true, create: true, edit: true, delete: true },
    plans:      { view: true, create: true, edit: true, delete: true },
    payments:   { view: true, create: true, edit: false, delete: false }, // Payments immutable, delete restricted to owner
    invoices:   { view: true, create: true, edit: false, delete: false },
    attendance: { view: true, create: true, edit: true, delete: true },
    staff:      { view: true, create: true, edit: true, delete: false }, // Cannot delete staff accounts
    leads:      { view: true, create: true, edit: true, delete: true },
    expenses:   { view: true, create: true, edit: true, delete: true },
    branches:   { view: true, create: false, edit: false, delete: false }, // Branch creation/deletion restricted to owner
    settings:   { view: false, create: false, edit: false, delete: false },
    gyms:       { view: false, create: false, edit: false, delete: false },
    dashboard:  { view: true, create: false, edit: false, delete: false },
  },

  "front-desk": {
    members:    { view: true, create: true, edit: true, delete: false }, // Cannot delete members
    plans:      { view: true, create: false, edit: false, delete: false }, // Read-only for plan assignment
    payments:   { view: true, create: true, edit: false, delete: false }, // Record payment only; cannot edit or void
    invoices:   { view: true, create: true, edit: false, delete: false },
    attendance: { view: true, create: true, edit: true, delete: false }, // Check-in, check-out, bulk entry; no purge
    staff:      { view: false, create: false, edit: false, delete: false }, // Cannot view or manage staff
    leads:      { view: true, create: true, edit: true, delete: false }, // Manage inquiries, follow-up, convert; no delete
    expenses:   { view: false, create: false, edit: false, delete: false }, // No financial expense access
    branches:   { view: true, create: false, edit: false, delete: false }, // View assigned branch contact/timings only
    settings:   { view: false, create: false, edit: false, delete: false }, // No settings access
    gyms:       { view: false, create: false, edit: false, delete: false },
    dashboard:  { view: true, create: false, edit: false, delete: false },
  },

  "trainer": {
    members:    { view: true, create: false, edit: false, delete: false },
    plans:      { view: true, create: false, edit: false, delete: false },
    payments:   { view: false, create: false, edit: false, delete: false },
    invoices:   { view: false, create: false, edit: false, delete: false },
    attendance: { view: true, create: true, edit: false, delete: false }, // Mark member attendance
    staff:      { view: false, create: false, edit: false, delete: false },
    leads:      { view: false, create: false, edit: false, delete: false },
    expenses:   { view: false, create: false, edit: false, delete: false },
    branches:   { view: true, create: false, edit: false, delete: false },
    settings:   { view: false, create: false, edit: false, delete: false },
    gyms:       { view: false, create: false, edit: false, delete: false },
    dashboard:  { view: true, create: false, edit: false, delete: false },
  },

  "accountant": {
    members:    { view: true, create: false, edit: false, delete: false },
    plans:      { view: true, create: false, edit: false, delete: false },
    payments:   { view: true, create: true, edit: false, delete: false },
    invoices:   { view: true, create: true, edit: false, delete: false },
    attendance: { view: false, create: false, edit: false, delete: false },
    staff:      { view: true, create: false, edit: false, delete: false }, // View for salary processing
    leads:      { view: false, create: false, edit: false, delete: false },
    expenses:   { view: true, create: true, edit: true, delete: false },
    branches:   { view: true, create: false, edit: false, delete: false },
    settings:   { view: false, create: false, edit: false, delete: false },
    gyms:       { view: false, create: false, edit: false, delete: false },
    dashboard:  { view: true, create: false, edit: false, delete: false },
  },
};

/**
 * Checks whether a given role has permission to perform an action on a module.
 *
 * @param {string} roleName - e.g. 'front-desk', 'admin', 'super-admin', 'system-admin'
 * @param {string} moduleName - e.g. 'members', 'plans', 'expenses'
 * @param {string} action - 'view' | 'create' | 'edit' | 'delete'
 * @returns {boolean}
 */
const hasPermission = (roleName, moduleName, action) => {
  if (!roleName || !moduleName || !action) return false;
  const rolePermissions = PERMISSION_MATRIX[roleName];
  if (!rolePermissions) return false;

  const modulePermissions = rolePermissions[moduleName];
  if (!modulePermissions) return false;

  return Boolean(modulePermissions[action]);
};

/**
 * Returns all roles that have permission to perform a specific action on a module.
 * Useful for bridging with legacy authorizeRoles(...roles) routes.
 *
 * @param {string} moduleName - e.g. 'members', 'plans', 'expenses'
 * @param {string} action - 'view' | 'create' | 'edit' | 'delete'
 * @returns {string[]} - Array of allowed role names
 */
const getAllowedRoles = (moduleName, action) => {
  const allowed = [];
  for (const [role, modules] of Object.entries(PERMISSION_MATRIX)) {
    if (modules[moduleName] && modules[moduleName][action]) {
      allowed.push(role);
    }
  }
  return allowed;
};

/**
 * Returns the entire permission map for a role.
 *
 * @param {string} roleName
 * @returns {object|null}
 */
const getRolePermissions = (roleName) => {
  return PERMISSION_MATRIX[roleName] || null;
};

module.exports = {
  PERMISSION_MATRIX,
  hasPermission,
  getAllowedRoles,
  getRolePermissions,
};
