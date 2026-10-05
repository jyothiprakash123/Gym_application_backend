const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/authRoutes");
const memberRoutes = require("./routes/memberRoutes");
const branchRoutes = require("./routes/branchRoutes");
const gymRoutes = require("./routes/gymRoutes");
const staffRoutes = require("./routes/staffRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const planRoutes = require("./routes/planRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const settingRoutes = require("./routes/settingRoutes");
const userRoutes = require("./routes/userRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const achievementRoutes = require("./routes/achievementRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const leadRoutes = require("./routes/leadRoutes");
const expenseRoutes = require("./routes/expenseRoutes");

const authenticate = require("./middleware/authMiddleware");
const authorizeRoles = require("./middleware/roleMiddleware");

const app = express();

// ======================================================
// GLOBAL MIDDLEWARE
// ======================================================

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  })
);

app.use(cookieParser());

// ======================================================
// HEALTH CHECK
// ======================================================
console.log("🔥 APP.JS LOADED - GYM BACKEND VERSION 2");
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Gym API is running",
  });
});

// ======================================================
// AUTH ROUTES
// ======================================================

app.use("/api/auth", authRoutes);

// ======================================================
// MEMBER ROUTES
// ======================================================

app.use("/api/members", memberRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/gyms", gymRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/settings", settingRoutes);
app.use("/api/users", userRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/achievements", achievementRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/expenses", expenseRoutes);

// ======================================================
// SUPER ADMIN TEST ROUTE
// ======================================================

// app.get(
//   "/api/test/super-admin",
//   authenticate,
//   authorizeRoles("super-admin"),
//   (req, res) => {
//     res.status(200).json({
//       success: true,
//       message: "Super Admin access granted",
//       user: {
//         id: req.user.id,
//         email: req.user.email,
//         role: req.user.role_name,
//       },
//     });
//   }
// );

// ======================================================
// 404
// ======================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// ======================================================
// ERROR HANDLER
// ======================================================

app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

module.exports = app;
