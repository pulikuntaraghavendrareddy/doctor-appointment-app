const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setup() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      password TEXT NOT NULL DEFAULT 'doctor123'
    );

    CREATE TABLE IF NOT EXISTS slots (
      id SERIAL PRIMARY KEY,
      doctor_id INTEGER NOT NULL REFERENCES doctors(id),
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      is_booked INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      slot_id INTEGER NOT NULL REFERENCES slots(id),
      patient_name TEXT NOT NULL,
      patient_contact TEXT NOT NULL,
      patient_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS patients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );
  `);

  const doctorCount = await pool.query('SELECT COUNT(*) FROM doctors');
  if (parseInt(doctorCount.rows[0].count) === 0) {
    const doc1 = await pool.query(`INSERT INTO doctors (name, specialty) VALUES ($1, $2) RETURNING id`, ['Dr. Anjali Rao', 'Cardiologist']);
    const doc2 = await pool.query(`INSERT INTO doctors (name, specialty) VALUES ($1, $2) RETURNING id`, ['Dr. Vikram Shah', 'Dermatologist']);
    const doc3 = await pool.query(`INSERT INTO doctors (name, specialty) VALUES ($1, $2) RETURNING id`, ['Dr. Priya Nair', 'Pediatrician']);

    const doctorIds = [doc1.rows[0].id, doc2.rows[0].id, doc3.rows[0].id];
    const times = ['10:00 AM', '11:30 AM', '2:00 PM', '4:30 PM'];

    for (const id of doctorIds) {
      for (const time of times) {
        await pool.query('INSERT INTO slots (doctor_id, date, time) VALUES ($1, $2, $3)', [id, '2026-08-05', time]);
      }
    }
  }
}

setup();

module.exports = pool;