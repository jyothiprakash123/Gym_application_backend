const pool = require("../config/db");

/**
 * Generates the next sequential invoice number for a given gym and month.
 * Format: INV-YYYYMM-XXXX (e.g. INV-202611-0001)
 *
 * Concurrency Safety:
 * Uses PostgreSQL row-level locks via INSERT ... ON CONFLICT (gym_id, year_month) DO UPDATE
 * so concurrent payments for the same gym always get consecutive, non-overlapping numbers.
 *
 * @param {object} client - pg client (from pool.connect()) inside a transaction
 * @param {string} gymId - UUID of the gym
 * @param {Date|string} [issuedAtDate=new Date()] - date of invoice issuance
 * @returns {Promise<{ invoiceNumber: string, sequence: number, yearMonth: string }>}
 */
async function generateNextInvoiceNumber(client, gymId, issuedAtDate = new Date()) {
  const executor = client || pool;
  const d = issuedAtDate instanceof Date ? issuedAtDate : new Date(issuedAtDate);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const yearMonth = `${year}${month}`;

  const query = `
    INSERT INTO invoice_sequences (gym_id, year_month, last_seq, updated_at)
    VALUES ($1, $2, 1, NOW())
    ON CONFLICT (gym_id, year_month)
    DO UPDATE SET 
      last_seq = invoice_sequences.last_seq + 1,
      updated_at = NOW()
    RETURNING last_seq;
  `;

  const result = await executor.query(query, [gymId, yearMonth]);
  const sequenceNum = result.rows[0].last_seq;
  const paddedSeq = String(sequenceNum).padStart(4, "0");
  const invoiceNumber = `INV-${yearMonth}-${paddedSeq}`;

  return {
    invoiceNumber,
    sequence: sequenceNum,
    yearMonth,
  };
}

/**
 * Validates whether an invoice number string matches INV-YYYYMM-XXXX format
 * @param {string} invNum
 * @returns {boolean}
 */
function isValidInvoiceNumber(invNum) {
  if (typeof invNum !== "string") return false;
  return /^INV-\d{6}-\d{4,}$/.test(invNum);
}

module.exports = {
  generateNextInvoiceNumber,
  isValidInvoiceNumber,
};
