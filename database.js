const Database = require('better-sqlite3');
const db = new Database('appointments.db');

// Create tables if they don't already exist
db.exec(`
  CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    is_booked INTEGER DEFAULT 0,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id INTEGER NOT NULL,
    patient_name TEXT NOT NULL,
    patient_contact TEXT NOT NULL,
    FOREIGN KEY (slot_id) REFERENCES slots(id)
  );
`);

// Only add sample doctors if the table is empty
const doctorCount = db.prepare('SELECT COUNT(*) as count FROM doctors').get();
if (doctorCount.count === 0) {
  const insertDoctor = db.prepare('INSERT INTO doctors (name, specialty) VALUES (?, ?)');
  const doc1 = insertDoctor.run('Dr. Anjali Rao', 'Cardiologist');
  const doc2 = insertDoctor.run('Dr. Vikram Shah', 'Dermatologist');
  const doc3 = insertDoctor.run('Dr. Priya Nair', 'Pediatrician');

  const insertSlot = db.prepare('INSERT INTO slots (doctor_id, date, time) VALUES (?, ?, ?)');
  const doctorIds = [doc1.lastInsertRowid, doc2.lastInsertRowid, doc3.lastInsertRowid];
  const times = ['10:00 AM', '11:30 AM', '2:00 PM', '4:30 PM'];

  doctorIds.forEach(id => {
    times.forEach(time => {
      insertSlot.run(id, '2026-08-05', time);
    });
  });
}

module.exports = db;