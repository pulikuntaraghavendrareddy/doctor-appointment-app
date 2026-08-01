const express = require('express');
const db = require('./database');
const app = express();
const PORT = 3000;

function layout(title, body) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <link rel="stylesheet" href="/style.css">
    </head>
    <body>
      ${body}
    </body>
    </html>
  `;
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Homepage: list all doctors
app.get('/', (req, res) => {
  const doctors = db.prepare('SELECT * FROM doctors').all();

  let html = '<h1>Book a Doctor Appointment</h1><ul>';
  doctors.forEach(doc => {
    html += `<li><a href="/doctor/${doc.id}">${doc.name} — ${doc.specialty}</a></li>`;
  });
  html += '</ul>';

  res.send(layout('Doctor Appointments', html));
});

// Doctor detail page: show their available slots
app.get('/doctor/:id', (req, res) => {
  const doctorId = req.params.id;
  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);

  if (!doctor) {
    return res.send(layout('Not Found', '<h1>Doctor not found</h1><a href="/">Back to home</a>'));
  }

  const slots = db.prepare('SELECT * FROM slots WHERE doctor_id = ? AND is_booked = 0').all(doctorId);

  let html = `<h1>${doctor.name} — ${doctor.specialty}</h1>`;
  html += '<h2>Available Slots</h2><ul>';
  slots.forEach(slot => {
    html += `<li>${slot.date} at ${slot.time} — <a href="/book/${slot.id}">Book this slot</a></li>`;
  });
  html += '</ul><a href="/">Back to home</a>';

  res.send(layout(doctor.name, html));
});

// Show booking form for a specific slot
app.get('/book/:id', (req, res) => {
  const slotId = req.params.id;
  const slot = db.prepare(`
    SELECT slots.*, doctors.name AS doctor_name
    FROM slots
    JOIN doctors ON slots.doctor_id = doctors.id
    WHERE slots.id = ?
  `).get(slotId);

  if (!slot || slot.is_booked) {
    return res.send(layout('Unavailable', '<h1>Sorry, this slot is unavailable</h1><a href="/">Back to home</a>'));
  }

  const html = `
    <h1>Book Appointment</h1>
    <p>${slot.doctor_name} — ${slot.date} at ${slot.time}</p>
    <form method="POST" action="/book/${slot.id}">
      <label>Your Name: <input type="text" name="patient_name" required></label>
      <label>Phone or Email: <input type="text" name="patient_contact" required></label>
      <button type="submit">Confirm Booking</button>
    </form>
  `;
  res.send(layout('Book Appointment', html));
});

// Handle the form submission
app.post('/book/:id', (req, res) => {
  const slotId = req.params.id;
  const { patient_name, patient_contact } = req.body;

  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId);
  if (!slot || slot.is_booked) {
    return res.send(layout('Unavailable', '<h1>Sorry, this slot is unavailable</h1><a href="/">Back to home</a>'));
  }

  db.prepare('INSERT INTO bookings (slot_id, patient_name, patient_contact) VALUES (?, ?, ?)')
    .run(slotId, patient_name, patient_contact);

  db.prepare('UPDATE slots SET is_booked = 1 WHERE id = ?').run(slotId);

  const html = `
    <h1>Booking Confirmed! ✅</h1>
    <p>Thanks, ${patient_name}. Your appointment is booked.</p>
    <a href="/">Back to home</a>
  `;
  res.send(layout('Confirmed', html));
});

// Admin page: view all bookings
app.get('/admin', (req, res) => {
  const password = req.query.password;

  if (password !== 'admin123') {
    const loginForm = `
      <h1>Admin Login</h1>
      <form method="GET" action="/admin">
        <label>Password: <input type="password" name="password" required></label>
        <button type="submit">Login</button>
      </form>
    `;
    return res.send(layout('Admin Login', loginForm));
  }

  const bookings = db.prepare(`
    SELECT bookings.*, slots.date, slots.time, doctors.name AS doctor_name
    FROM bookings
    JOIN slots ON bookings.slot_id = slots.id
    JOIN doctors ON slots.doctor_id = doctors.id
    ORDER BY slots.date, slots.time
  `).all();

  let html = '<h1>All Bookings (Admin)</h1><table><tr><th>Patient</th><th>Contact</th><th>Doctor</th><th>Date</th><th>Time</th></tr>';
  bookings.forEach(b => {
    html += `<tr><td>${b.patient_name}</td><td>${b.patient_contact}</td><td>${b.doctor_name}</td><td>${b.date}</td><td>${b.time}</td></tr>`;
  });
  html += '</table><br><a href="/">Back to home</a>';

  res.send(layout('Admin', html));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});