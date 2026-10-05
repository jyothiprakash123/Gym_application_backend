const pool = require("../config/db");

exports.getOverview = async (req, res) => {
  try {
    const { gymId, branchId } = req.query;

    let memberJoin = "";
    let branchJoin = "";
    let whereCondition = "1=1";
    let params = [];

    // Depending on what is provided, we need to join branches to filter by gymId.
    if (branchId) {
      whereCondition += ` AND branch_id = $${params.length + 1}`;
      params.push(branchId);
    } else if (gymId) {
      // Need to join branches to get gym_id for tables that don't have gym_id natively (like members, attendance)
      // Actually, members has branch_id, attendance has branch_id.
      // So we can just join branches.
    }

    // A helper function to build queries easily
    const buildQuery = (baseTable, countColumn = "*", extraWhere = "", dateCol = null, groupBy = null) => {
      let q = `SELECT `;
      
      if (groupBy) {
        q += `${groupBy.select} `;
      } else {
        q += `COUNT(${countColumn}) `;
      }
      
      q += `FROM ${baseTable} main_table `;
      
      let p = [];
      let w = `WHERE 1=1 `;
      
      if (branchId) {
        w += `AND main_table.branch_id = $1 `;
        p.push(branchId);
      } else if (gymId) {
        q += `JOIN branches b ON b.id = main_table.branch_id `;
        w += `AND b.gym_id = $1 `;
        p.push(gymId);
      }
      
      if (extraWhere) {
        w += `AND (${extraWhere}) `;
      }
      
      q += w;
      
      if (groupBy) {
        q += `GROUP BY ${groupBy.group} ORDER BY ${groupBy.order}`;
      }
      
      // We have to correctly interpolate parameters if we want to use pg's parameterization,
      // but since extraWhere might have its own parameters, this can be tricky.
      // Wait, in the original queries, no params were used except CURRENT_DATE (which is SQL).
      return { text: q, values: p };
    };

    const getCond = (tableAlias) => {
      let q = ""; let w = "WHERE 1=1"; let p = [];
      if (branchId) {
        w += ` AND ${tableAlias}.branch_id = $1`;
        p.push(branchId);
      } else if (gymId) {
        q += ` JOIN branches b ON b.id = ${tableAlias}.branch_id`;
        w += ` AND b.gym_id = $1`;
        p.push(gymId);
      }
      return { join: q, where: w, params: p };
    };

    const membersCond = getCond('main_table');
    const qMembers = {
      text: `SELECT 
        COUNT(*) as total_members,
        COUNT(*) FILTER (WHERE main_table.is_active = true) as active_members,
        COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM main_table.created_at) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM main_table.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)) as new_members,
        COUNT(*) FILTER (WHERE main_table.created_at < DATE_TRUNC('month', CURRENT_DATE)) as last_month_members
      FROM members main_table ${membersCond.join} ${membersCond.where}`,
      values: membersCond.params
    };

    const membershipsCond = getCond('main_table');
    const qMemberships = {
      text: `SELECT 
        COUNT(*) FILTER (WHERE main_table.status = 'active' AND EXTRACT(MONTH FROM main_table.end_date) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM main_table.end_date) = EXTRACT(YEAR FROM CURRENT_DATE)) as expiring_memberships,
        COUNT(*) FILTER (WHERE main_table.status = 'expired') as expired_memberships
      FROM member_memberships main_table ${membershipsCond.join} ${membershipsCond.where}`,
      values: membershipsCond.params
    };

    const paymentsCond = getCond('main_table');
    const qPayments = {
      text: `SELECT 
        COALESCE(SUM(main_table.amount) FILTER (WHERE main_table.status = 'completed' AND EXTRACT(MONTH FROM main_table.payment_date) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM main_table.payment_date) = EXTRACT(YEAR FROM CURRENT_DATE)), 0) as monthly_revenue,
        COUNT(*) FILTER (WHERE main_table.status = 'pending') as pending_payments
      FROM payments main_table ${paymentsCond.join} ${paymentsCond.where}`,
      values: paymentsCond.params
    };

    const qTodayCheckins = buildQuery("attendance", "*", "DATE(main_table.check_in) = CURRENT_DATE");

    // 9. Member Growth
    const qMemberGrowth = buildQuery("members", "*", "main_table.created_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'", null, {
      select: "TO_CHAR(DATE_TRUNC('month', main_table.created_at), 'Mon') as name, COUNT(*) as members",
      group: "DATE_TRUNC('month', main_table.created_at)",
      order: "DATE_TRUNC('month', main_table.created_at) ASC"
    });

    // 10. Revenue Trend
    const qRevenueTrend = buildQuery("payments", "*", "main_table.status = 'completed' AND main_table.payment_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'", null, {
      select: "TO_CHAR(DATE_TRUNC('month', main_table.payment_date), 'Mon') as name, COALESCE(SUM(main_table.amount), 0) as revenue",
      group: "DATE_TRUNC('month', main_table.payment_date)",
      order: "DATE_TRUNC('month', main_table.payment_date) ASC"
    });

    // 11. Recent Activity
    let pActivity = [];
    let activityBranchJoin = "";
    let activityWhere = "";
    
    if (branchId) {
      activityWhere = `WHERE branch_id = $1`;
      pActivity.push(branchId);
    } else if (gymId) {
      activityBranchJoin = `JOIN branches b ON b.id = main_table.branch_id`;
      activityWhere = `WHERE b.gym_id = $1`;
      pActivity.push(gymId);
    }

    // Reconstruct recent activity
    const qRecentActivity = {
      text: `
        SELECT * FROM (
          SELECT 
            'registration' as type, 
            'New member joined: ' || main_table.full_name as text, 
            main_table.created_at as action_time
          FROM members main_table
          ${activityBranchJoin}
          ${activityWhere}
          
          UNION ALL
          
          SELECT 
            'payment' as type, 
            'Payment of ₹' || main_table.amount || ' received' as text, 
            main_table.payment_date as action_time
          FROM payments main_table
          ${activityBranchJoin}
          ${activityWhere ? activityWhere + " AND main_table.status = 'completed'" : "WHERE main_table.status = 'completed'"}
          
          UNION ALL
          
          SELECT 
            'checkin' as type, 
            'Member check-in recorded' as text, 
            main_table.check_in as action_time
          FROM attendance main_table
          ${activityBranchJoin}
          ${activityWhere}
        ) all_activities
        ORDER BY action_time DESC
        LIMIT 5
      `,
      values: pActivity.length > 0 ? [pActivity[0], pActivity[0], pActivity[0]] : [] // Since we use $1 in each subquery and UNION ALL combines them, we need to pass the param 3 times or use placeholders carefully. Wait, if we use $1 in 3 different SELECTs connected by UNION ALL, we can just pass it once? No, pg driver expects $1, $1, $1 to match the single parameter provided. Yes, pg allows using $1 multiple times for the same value!
    };
    if (pActivity.length > 0) {
      // If we use $1 in each subquery, we can just pass [branchId] or [gymId]
      qRecentActivity.values = [pActivity[0]];
    }

    const [
      membersResult,
      membershipsResult,
      paymentsResult,
      todayCheckinsResult,
      memberGrowthResult,
      revenueTrendResult,
      recentActivityResult
    ] = await Promise.all([
      pool.query(qMembers.text, qMembers.values),
      pool.query(qMemberships.text, qMemberships.values),
      pool.query(qPayments.text, qPayments.values),
      pool.query(qTodayCheckins.text, qTodayCheckins.values),
      pool.query(qMemberGrowth.text, qMemberGrowth.values),
      pool.query(qRevenueTrend.text, qRevenueTrend.values),
      pool.query(qRecentActivity.text, qRecentActivity.values)
    ]);

    const formatTimeAgo = (date) => {
      const seconds = Math.floor((new Date() - date) / 1000);
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

    const recentActivityFormatted = recentActivityResult.rows.map((row, index) => ({
      id: index + 1,
      type: row.type,
      text: row.text,
      time: formatTimeAgo(new Date(row.action_time))
    }));

    const currentMembersCount = parseInt(membersResult.rows[0]?.total_members || 0);
    const lastMonthMembersCount = parseInt(membersResult.rows[0]?.last_month_members || 0);
    let memberGrowthPct = 0;
    if (lastMonthMembersCount > 0) {
      memberGrowthPct = ((currentMembersCount - lastMonthMembersCount) / lastMonthMembersCount) * 100;
    } else if (currentMembersCount > 0) {
      memberGrowthPct = 100;
    }
    
    const monthlyRev = parseFloat(paymentsResult.rows[0]?.monthly_revenue || 0);
    const expiringCount = parseInt(membershipsResult.rows[0]?.expiring_memberships || 0);

    const dynamicData = {
      kpis: {
        totalMembers: currentMembersCount,
        activeMembers: parseInt(membersResult.rows[0]?.active_members || 0),
        expiringMemberships: expiringCount,
        todayCheckins: parseInt(todayCheckinsResult.rows[0]?.count || 0),
        monthlyRevenue: monthlyRev,
        pendingPayments: parseInt(paymentsResult.rows[0]?.pending_payments || 0),
        newMembers: parseInt(membersResult.rows[0]?.new_members || 0),
        expiredMemberships: parseInt(membershipsResult.rows[0]?.expired_memberships || 0),
        
        memberGrowthText: `${memberGrowthPct > 0 ? '+' : ''}${memberGrowthPct.toFixed(1)}% vs last month`,
        memberGrowthType: memberGrowthPct > 0 ? 'positive' : (memberGrowthPct < 0 ? 'negative' : 'neutral'),
        expiringText: `${expiringCount} expiring this month`,
        revenueText: `₹${monthlyRev.toLocaleString()} collected`
      },
      memberGrowth: memberGrowthResult.rows.map(row => ({
        name: row.name,
        members: parseInt(row.members)
      })),
      revenueTrend: revenueTrendResult.rows.map(row => ({
        name: row.name,
        revenue: parseFloat(row.revenue)
      })),
      recentActivity: recentActivityFormatted
    };

    res.status(200).json({
      status: "success",
      data: dynamicData
    });
  } catch (error) {
    console.error("Dashboard overview error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch dashboard overview"
    });
  }
};
