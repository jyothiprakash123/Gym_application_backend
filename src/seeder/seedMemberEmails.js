require('dotenv').config();
const pool = require('../config/db');

async function seedMembers() {
  const branch1Id = '630b3844-e660-45a5-bdbc-abc8c0f19802';
  const branch2Id = '38af11b9-0eff-41b0-9cac-a40a74fb31cf';

  const members = [
    { name: 'Alex Johnson', email: 'alex.johnson@example.com', phone: '9876543210', branch: branch1Id },
    { name: 'Sarah Miller', email: 'sarah.miller@example.com', phone: '9876543211', branch: branch1Id },
    { name: 'David Kumar', email: 'david.kumar@example.com', phone: '9876543212', branch: branch1Id },
    { name: 'Priya Sharma', email: 'priya.sharma@example.com', phone: '9876543213', branch: branch2Id },
    { name: 'Rahul Verma', email: 'rahul.verma@example.com', phone: '9876543214', branch: branch2Id },
    { name: 'Emma Watson', email: 'emma.watson@example.com', phone: '9876543215', branch: branch2Id }
  ];

  for (const m of members) {
    const existing = await pool.query('SELECT id FROM members WHERE email = $1', [m.email]);
    if (existing.rows.length === 0) {
      await pool.query(
        'INSERT INTO members (id, branch_id, full_name, email, phone, join_date, is_active) VALUES (gen_random_uuid(), $1, $2, $3, $4, CURRENT_DATE, true)',
        [m.branch, m.name, m.email, m.phone]
      );
    }
  }

  await pool.query(
    "UPDATE members SET email = LOWER(REPLACE(full_name, ' ', '.')) || '@example.com' WHERE email IS NULL"
  );

  const res = await pool.query('SELECT count(*) FROM members WHERE email IS NOT NULL');
  console.log('Total members with emails:', res.rows[0].count);
  process.exit(0);
}

seedMembers().catch(e => { console.error(e); process.exit(1); });
