const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const { getAllowedRoles } = require('../config/rbacConfig');

router.use(authenticate);

router.get('/category-breakdown', authorizeRoles(...getAllowedRoles("expenses", "view")), expenseController.getCategoryBreakdown);
router.get('/net-summary', authorizeRoles(...getAllowedRoles("expenses", "view")), expenseController.getNetSummary);
router.get('/', authorizeRoles(...getAllowedRoles("expenses", "view")), expenseController.getExpenses);
router.get('/:id', authorizeRoles(...getAllowedRoles("expenses", "view")), expenseController.getExpenseById);
router.post('/', authorizeRoles(...getAllowedRoles("expenses", "create")), expenseController.createExpense);
router.put('/:id', authorizeRoles(...getAllowedRoles("expenses", "edit")), expenseController.updateExpense);
router.delete('/:id', authorizeRoles(...getAllowedRoles("expenses", "delete")), expenseController.deleteExpense);

module.exports = router;
