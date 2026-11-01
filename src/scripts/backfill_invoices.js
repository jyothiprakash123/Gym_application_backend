const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const pool = require("../config/db");
const { generateNextInvoiceNumber } = require("../utils/invoiceUtils");

// Payment mode normalizer
const MODE_MAP = {
  cash: "Cash",
  card: "Card",
  "credit card": "Card",
  "debit card": "Card",
  upi: "UPI",
  "bank transfer": "Bank Transfer",
  bank_transfer: "Bank Transfer",
  netbanking: "NetBanking",
  cheque: "Cheque",
  check: "Cheque",
  on_hold: "On Hold",
};

function normalizePaymentMode(mode) {
  if (!mode) return "Cash";
  const key = String(mode).trim().toLowerCase();
  return MODE_MAP[key] || "Cash";
}

async function backfillInvoices() {
  console.log("==================================================================");
  console.log(" INVOICE BACKFILL SCRIPT (FitZone Gym SaaS - Day 6 Prompt 3)");
  console.log("==================================================================");

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // 1. Fetch all payments that do not currently have an invoice
    const query = `
      SELECT 
        p.id,
        p.member_id,
        p.membership_id,
        p.gym_id,
        p.branch_id,
        p.amount,
        p.payment_mode,
        p.payment_date,
        p.created_at,
        p.status,
        p.notes,
        COALESCE(mp.name, p.notes, 'Gym Membership Fee') AS resolved_plan_name
      FROM payments p
      LEFT JOIN invoices inv ON inv.payment_id = p.id
      LEFT JOIN member_memberships mm ON mm.id = p.membership_id
      LEFT JOIN membership_plans mp ON mp.id = mm.plan_id
      WHERE inv.id IS NULL
      ORDER BY COALESCE(p.payment_date, p.created_at) ASC, p.created_at ASC, p.id ASC
    `;

    const pendingResult = await client.query(query);
    const paymentsToBackfill = pendingResult.rows;

    console.log(`Found ${paymentsToBackfill.length} existing payment(s) needing invoices.`);

    if (paymentsToBackfill.length === 0) {
      console.log("✓ All existing payments already have linked invoices. Nothing to backfill.");
      await client.query("COMMIT");
      return { total: 0, backfilled: 0 };
    }

    let backfilledCount = 0;

    for (const payment of paymentsToBackfill) {
      // Determine effective issue date (use payment_date or created_at)
      const issuedAtDate = payment.payment_date
        ? new Date(payment.payment_date)
        : new Date(payment.created_at);

      // Generate sequential invoice number (per gym per month)
      const { invoiceNumber } = await generateNextInvoiceNumber(
        client,
        payment.gym_id,
        issuedAtDate
      );

      const normalizedMode = normalizePaymentMode(payment.payment_mode);
      const invoiceStatus = payment.status === "cancelled"
        ? "cancelled"
        : normalizedMode === "On Hold"
        ? "unpaid"
        : "paid";

      const numAmount = Number(payment.amount) || 0;

      await client.query(
        `
        INSERT INTO invoices (
          invoice_number,
          payment_id,
          gym_id,
          branch_id,
          member_id,
          plan_name,
          amount,
          subtotal,
          total,
          payment_mode,
          status,
          issued_date,
          issued_at,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING
        `,
        [
          invoiceNumber,
          payment.id,
          payment.gym_id,
          payment.branch_id,
          payment.member_id,
          payment.resolved_plan_name,
          numAmount,
          numAmount,
          numAmount,
          normalizedMode,
          invoiceStatus,
          issuedAtDate,
          issuedAtDate,
          payment.created_at || new Date(),
        ]
      );

      backfilledCount++;
      if (backfilledCount % 10 === 0 || backfilledCount === paymentsToBackfill.length) {
        console.log(`Processed ${backfilledCount} / ${paymentsToBackfill.length} invoices...`);
      }
    }

    await client.query("COMMIT");
    console.log("==================================================================");
    console.log(`✓ Backfill complete! Successfully created ${backfilledCount} invoice(s).`);
    console.log("==================================================================");

    return { total: paymentsToBackfill.length, backfilled: backfilledCount };
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rbErr) {
        console.error("Rollback error:", rbErr);
      }
    }
    console.error("BACKFILL ERROR:", error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Allow direct execution from CLI
if (require.main === module) {
  backfillInvoices()
    .then(() => {
      pool.end();
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      pool.end();
      process.exit(1);
    });
}

module.exports = { backfillInvoices };
