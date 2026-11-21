const pool = require("../config/db");
const { resolveBranchAccess } = require("../middleware/tenantMiddleware");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Helper to generate the continuous last N months (6 or 12) in Asia/Kolkata
const getContinuousMonths = (count = 6) => {
  const months = [];
  const now = new Date();
  const istFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = istFormatter.formatToParts(now);
  const istYear = parseInt(parts.find((p) => p.type === "year").value, 10);
  const istMonth = parseInt(parts.find((p) => p.type === "month").value, 10);

  for (let i = count - 1; i >= 0; i--) {
    let m = istMonth - i;
    let y = istYear;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const d = new Date(Date.UTC(y, m - 1, 1));
    const name = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const shortYear = String(y).slice(-2);
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.push({
      key,
      name,
      axisLabel: count > 6 ? `${name} '${shortYear}` : name,
      fullLabel: `${name} ${y}`,
    });
  }
  return months;
};

// ======================================================
// GET DASHBOARD OVERVIEW
// ======================================================
exports.getOverview = async (req, res) => {
  try {
    // Resolve tenant scoping and branch access via centralized helper
    const branchAccess = resolveBranchAccess(req);

    if (
      !branchAccess.gymId &&
      !branchAccess.branchId &&
      branchAccess.type !== "ALL"
    ) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to view dashboard data",
      });
    }

    // Reject malformed UUID filters early rather than letting PostgreSQL throw 500
    if (
      (branchAccess.gymId && !UUID_REGEX.test(branchAccess.gymId)) ||
      (branchAccess.branchId && !UUID_REGEX.test(branchAccess.branchId))
    ) {
      return res.status(400).json({
        status: "error",
        message: "Invalid gym or branch identifier",
      });
    }

    // Verify branch belongs to gymId if both are specified to prevent cross-tenant data leak
    if (branchAccess.branchId && branchAccess.gymId) {
      const branchValid = await pool.query(
        "SELECT id FROM branches WHERE id = $1 AND gym_id = $2 LIMIT 1",
        [branchAccess.branchId, branchAccess.gymId]
      );
      if (branchValid.rows.length === 0) {
        return res.status(403).json({
          status: "error",
          message: "You do not have access to this branch",
        });
      }
    }

    // Build conditions per table respecting branch vs gym scoping
    let membersCond, membershipsCond, paymentsCond, attendanceCond;
    let queryParams = [];

    if (branchAccess.type === "BRANCH") {
      queryParams = [branchAccess.branchId];
      membersCond = {
        join: "",
        where: "WHERE main_table.branch_id = $1",
        params: queryParams,
      };
      membershipsCond = {
        join: "JOIN members m ON m.id = main_table.member_id",
        where: "WHERE COALESCE(main_table.branch_id, m.branch_id) = $1",
        params: queryParams,
      };
      paymentsCond = {
        join: "",
        where: "WHERE main_table.branch_id = $1",
        params: queryParams,
      };
      attendanceCond = {
        join: "",
        where: "WHERE main_table.branch_id = $1",
        params: queryParams,
      };
    } else if (branchAccess.type === "GYM") {
      queryParams = [branchAccess.gymId];
      membersCond = {
        join: "JOIN branches b ON b.id = main_table.branch_id",
        where: "WHERE b.gym_id = $1",
        params: queryParams,
      };
      membershipsCond = {
        join: "JOIN members m ON m.id = main_table.member_id JOIN branches b ON b.id = COALESCE(main_table.branch_id, m.branch_id)",
        where: "WHERE (main_table.gym_id = $1 OR b.gym_id = $1)",
        params: queryParams,
      };
      paymentsCond = {
        join: "LEFT JOIN branches b ON b.id = main_table.branch_id",
        where: "WHERE (main_table.gym_id = $1 OR b.gym_id = $1)",
        params: queryParams,
      };
      attendanceCond = {
        join: "JOIN branches b ON b.id = main_table.branch_id",
        where: "WHERE b.gym_id = $1",
        params: queryParams,
      };
    } else {
      // type === "ALL" (system admin unrestricted view)
      membersCond = { join: "", where: "WHERE 1=1", params: [] };
      membershipsCond = { join: "", where: "WHERE 1=1", params: [] };
      paymentsCond = { join: "", where: "WHERE 1=1", params: [] };
      attendanceCond = { join: "", where: "WHERE 1=1", params: [] };
    }

    // 1. Members KPI: Total, Active (membership active today & not frozen), New (this month IST), Last Month
    const qMembers = {
      text: `SELECT 
        COUNT(DISTINCT main_table.id) as total_members,
        COUNT(DISTINCT main_table.id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM member_memberships mm 
            WHERE mm.member_id = main_table.id 
              AND mm.status = 'active'
              AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date BETWEEN mm.start_date AND mm.end_date
              AND (
                mm.freeze_start IS NULL 
                OR mm.freeze_end IS NULL 
                OR NOT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date BETWEEN mm.freeze_start AND mm.freeze_end)
              )
          )
        ) as active_members,
        COUNT(DISTINCT main_table.id) FILTER (
          WHERE EXTRACT(MONTH FROM main_table.created_at AT TIME ZONE 'Asia/Kolkata') = EXTRACT(MONTH FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
            AND EXTRACT(YEAR FROM main_table.created_at AT TIME ZONE 'Asia/Kolkata') = EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
        ) as new_members,
        COUNT(DISTINCT main_table.id) FILTER (
          WHERE (main_table.created_at AT TIME ZONE 'Asia/Kolkata') < DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
        ) as last_month_members
      FROM members main_table ${membersCond.join} ${membersCond.where}`,
      values: membersCond.params,
    };

    // 2. Memberships KPI: Expiring this Month (active & end date in current month IST), Expired
    const qMemberships = {
      text: `SELECT 
        COUNT(DISTINCT main_table.id) FILTER (
          WHERE main_table.status = 'active'
            AND main_table.end_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
            AND EXTRACT(MONTH FROM main_table.end_date) = EXTRACT(MONTH FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
            AND EXTRACT(YEAR FROM main_table.end_date) = EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
        ) as expiring_memberships,
        COUNT(DISTINCT main_table.id) FILTER (
          WHERE main_table.status = 'expired'
            OR (main_table.status = 'active' AND main_table.end_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date)
        ) as expired_memberships
      FROM member_memberships main_table ${membershipsCond.join} ${membershipsCond.where}`,
      values: membershipsCond.params,
    };

    // 3. Payments KPI: Monthly Revenue (completed payments in current month IST), Pending Payments
    const qPayments = {
      text: `SELECT 
        COALESCE(SUM(main_table.amount) FILTER (
          WHERE main_table.status = 'completed'
            AND EXTRACT(MONTH FROM main_table.payment_date AT TIME ZONE 'Asia/Kolkata') = EXTRACT(MONTH FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
            AND EXTRACT(YEAR FROM main_table.payment_date AT TIME ZONE 'Asia/Kolkata') = EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
        ), 0) as monthly_revenue,
        COUNT(*) FILTER (WHERE main_table.status = 'pending') as pending_payments
      FROM payments main_table ${paymentsCond.join} ${paymentsCond.where}`,
      values: paymentsCond.params,
    };

    // 4. Today's Check-ins KPI: attendance_date = CURRENT_DATE (IST) AND status = 1
    const qTodayCheckins = {
      text: `SELECT 
        COUNT(*) as count
      FROM attendance main_table ${attendanceCond.join} ${attendanceCond.where}
        AND main_table.attendance_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
        AND main_table.status = 1`,
      values: attendanceCond.params,
    };

    const parsedMonths = parseInt(req.query?.months, 10);
    const chartMonths = parsedMonths === 12 ? 12 : 6;
    const lookbackInterval = `${chartMonths - 1} months`;

    // 5. Member Growth: 6 or 12 months continuous
    const memberGrowthParams = [...membersCond.params, lookbackInterval];
    const memberGrowthIntervalIdx = memberGrowthParams.length;
    const qMemberGrowth = {
      text: `SELECT 
        TO_CHAR(DATE_TRUNC('month', main_table.created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') as month_key,
        TO_CHAR(DATE_TRUNC('month', main_table.created_at AT TIME ZONE 'Asia/Kolkata'), 'Mon') as name,
        COUNT(DISTINCT main_table.id) as members
      FROM members main_table ${membersCond.join} ${membersCond.where}
        AND (main_table.created_at AT TIME ZONE 'Asia/Kolkata') >= (DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - $${memberGrowthIntervalIdx}::interval)
      GROUP BY DATE_TRUNC('month', main_table.created_at AT TIME ZONE 'Asia/Kolkata')
      ORDER BY DATE_TRUNC('month', main_table.created_at AT TIME ZONE 'Asia/Kolkata') ASC`,
      values: memberGrowthParams,
    };

    // 6. Revenue Trend: 6 or 12 months continuous
    const revenueTrendParams = [...paymentsCond.params, lookbackInterval];
    const revenueTrendIntervalIdx = revenueTrendParams.length;
    const qRevenueTrend = {
      text: `SELECT 
        TO_CHAR(DATE_TRUNC('month', main_table.payment_date AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') as month_key,
        TO_CHAR(DATE_TRUNC('month', main_table.payment_date AT TIME ZONE 'Asia/Kolkata'), 'Mon') as name,
        COALESCE(SUM(main_table.amount), 0) as revenue
      FROM payments main_table ${paymentsCond.join} ${paymentsCond.where}
        AND main_table.status = 'completed'
        AND (main_table.payment_date AT TIME ZONE 'Asia/Kolkata') >= (DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - $${revenueTrendIntervalIdx}::interval)
      GROUP BY DATE_TRUNC('month', main_table.payment_date AT TIME ZONE 'Asia/Kolkata')
      ORDER BY DATE_TRUNC('month', main_table.payment_date AT TIME ZONE 'Asia/Kolkata') ASC`,
      values: revenueTrendParams,
    };

    // 7. Recent Activity (Latest 5 actions)
    const qRecentActivity = {
      text: `
        SELECT * FROM (
          SELECT 
            'registration' as type, 
            'New member joined: ' || main_table.full_name as text, 
            main_table.created_at as action_time
          FROM members main_table
          ${membersCond.join}
          ${membersCond.where}
          
          UNION ALL
          
          SELECT 
            'payment' as type, 
            'Payment of ₹' || main_table.amount || ' received' as text, 
            main_table.payment_date as action_time
          FROM payments main_table
          ${paymentsCond.join}
          ${paymentsCond.where} AND main_table.status = 'completed'
          
          UNION ALL
          
          SELECT 
            'checkin' as type, 
            'Member check-in recorded' as text, 
            COALESCE(main_table.check_in, main_table.created_at) as action_time
          FROM attendance main_table
          ${attendanceCond.join}
          ${attendanceCond.where} AND main_table.status = 1
        ) all_activities
        ORDER BY action_time DESC
        LIMIT 5
      `,
      values: queryParams.length > 0 ? [queryParams[0]] : [],
    };

    const [
      membersResult,
      membershipsResult,
      paymentsResult,
      todayCheckinsResult,
      memberGrowthResult,
      revenueTrendResult,
      recentActivityResult,
    ] = await Promise.all([
      pool.query(qMembers.text, qMembers.values),
      pool.query(qMemberships.text, qMemberships.values),
      pool.query(qPayments.text, qPayments.values),
      pool.query(qTodayCheckins.text, qTodayCheckins.values),
      pool.query(qMemberGrowth.text, qMemberGrowth.values),
      pool.query(qRevenueTrend.text, qRevenueTrend.values),
      pool.query(qRecentActivity.text, qRecentActivity.values),
    ]);

    const formatTimeAgo = (date) => {
      if (!date || isNaN(new Date(date).getTime())) return "just now";
      const seconds = Math.floor((new Date() - new Date(date)) / 1000);
      let interval = seconds / 31536000;
      if (interval > 1) return Math.floor(interval) + " years ago";
      interval = seconds / 2592000;
      if (interval > 1) return Math.floor(interval) + " months ago";
      interval = seconds / 86400;
      if (interval > 1) return Math.floor(interval) + " days ago";
      interval = seconds / 3600;
      if (interval > 1) return Math.floor(interval) + " hours ago";
      interval = seconds / 60;
      if (interval > 1) return Math.floor(interval) + " mins ago";
      return "just now";
    };

    const recentActivityFormatted = recentActivityResult.rows.map(
      (row, index) => ({
        id: index + 1,
        type: row.type,
        text: row.text,
        time: formatTimeAgo(row.action_time),
      })
    );

    // Calculate month-over-month growth percentage
    const currentMembersCount = parseInt(
      membersResult.rows[0]?.total_members || 0
    );
    const lastMonthMembersCount = parseInt(
      membersResult.rows[0]?.last_month_members || 0
    );
    let memberGrowthPct = 0;
    if (lastMonthMembersCount > 0) {
      memberGrowthPct =
        ((currentMembersCount - lastMonthMembersCount) /
          lastMonthMembersCount) *
        100;
    } else if (currentMembersCount > 0) {
      memberGrowthPct = 100;
    }

    const monthlyRev = parseFloat(
      paymentsResult.rows[0]?.monthly_revenue || 0
    );
    const expiringCount = parseInt(
      membershipsResult.rows[0]?.expiring_memberships || 0
    );

    // Continuous 6- or 12-month sequence with zero-fill
    const continuousMonths = getContinuousMonths(chartMonths);

    const revMap = {};
    revenueTrendResult.rows.forEach((r) => {
      revMap[r.month_key] = parseFloat(r.revenue);
    });
    const formattedRevenueTrend = continuousMonths.map((m) => ({
      key: m.key,
      name: m.name,
      axisLabel: m.axisLabel,
      fullLabel: m.fullLabel,
      revenue: revMap[m.key] || 0,
    }));

    const memMap = {};
    memberGrowthResult.rows.forEach((r) => {
      memMap[r.month_key] = parseInt(r.members, 10);
    });
    const formattedMemberGrowth = continuousMonths.map((m) => ({
      key: m.key,
      name: m.name,
      axisLabel: m.axisLabel,
      fullLabel: m.fullLabel,
      members: memMap[m.key] || 0,
    }));

    const dynamicData = {
      kpis: {
        totalMembers: currentMembersCount,
        activeMembers: parseInt(membersResult.rows[0]?.active_members || 0),
        expiringMemberships: expiringCount,
        todayCheckins: parseInt(todayCheckinsResult.rows[0]?.count || 0),
        monthlyRevenue: monthlyRev,
        pendingPayments: parseInt(paymentsResult.rows[0]?.pending_payments || 0),
        newMembers: parseInt(membersResult.rows[0]?.new_members || 0),
        expiredMemberships: parseInt(
          membershipsResult.rows[0]?.expired_memberships || 0
        ),

        memberGrowthText: `${memberGrowthPct > 0 ? "+" : ""}${memberGrowthPct.toFixed(1)}% vs last month`,
        memberGrowthType:
          memberGrowthPct > 0
            ? "positive"
            : memberGrowthPct < 0
              ? "negative"
              : "neutral",
        expiringText: `${expiringCount} expiring this month`,
        revenueText: `₹${monthlyRev.toLocaleString("en-IN")} collected`,
      },
      chartMonths,
      memberGrowth: formattedMemberGrowth,
      revenueTrend: formattedRevenueTrend,
      recentActivity: recentActivityFormatted,
    };

    res.status(200).json({
      status: "success",
      data: dynamicData,
    });
  } catch (error) {
    console.error("Dashboard overview error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch dashboard overview",
    });
  }
};
