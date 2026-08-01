require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('./database');
const app = express();
const PORT = 3000;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

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
app.use(session({
  secret: 'doctor-app-secret-key',
  resave: false,
  saveUninitialized: false
}));
// Homepage: list all doctors

app.get('/', (req, res) => {
  const doctors = db.prepare('SELECT * FROM doctors').all();

  let nav = '<p>';
  if (req.session.patientId) {
    nav += '<a href="/my-bookings">My Bookings</a> | <a href="/logout">Logout</a>';
  } else {
    nav += '<a href="/login">Patient Login</a> | <a href="/signup">Sign Up</a>';
  }
  nav += ' | <a href="/doctor-login">Doctor Login</a> | <a href="/admin">Admin</a></p>';

  let html = nav + '<h1>Book a Doctor Appointment</h1><ul>';
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

  const patientId = req.session.patientId || null;
db.prepare('INSERT INTO bookings (slot_id, patient_name, patient_contact, patient_id) VALUES (?, ?, ?, ?)')
    .run(slotId, patient_name, patient_contact, patientId);
 db.prepare('UPDATE slots SET is_booked = 1 WHERE id = ?').run(slotId);

  // Send confirmation email (only if patient_contact looks like an email)
  if (patient_contact.includes('@')) {
    transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: patient_contact,
      subject: 'Appointment Confirmed',
      text: `Hi ${patient_name},\n\nYour appointment with ${slot.doctor_name} on ${slot.date} at ${slot.time} is confirmed.\n\nThanks!`
    }).catch(err => console.log('Email failed to send:', err.message));
  }

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

  let html = '<h1>All Bookings (Admin)</h1><table><tr><th>Patient</th><th>Contact</th><th>Doctor</th><th>Date</th><th>Time</th><th>Action</th></tr>';
  bookings.forEach(b => {
    html += `<tr><td>${b.patient_name}</td><td>${b.patient_contact}</td><td>${b.doctor_name}</td><td>${b.date}</td><td>${b.time}</td><td>
  <form method="POST" action="/admin/cancel/${b.id}" style="margin:0">
    <input type="hidden" name="password" value="${password}">
    <button type="submit" onclick="return confirm('Cancel this booking?')">Cancel</button>
  </form>
</td></tr>`;
  });
  html += '</table><br><a href="/">Back to home</a>';

  res.send(layout('Admin', html));
});
// Cancel a booking
app.post('/admin/cancel/:bookingId', (req, res) => {
  const bookingId = req.params.bookingId;
  const password = req.body.password;

  if (password !== 'admin123') {
    return res.send('<h1>Not authorized</h1><a href="/admin">Back to admin</a>');
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) {
    return res.send('<h1>Booking not found</h1><a href="/admin">Back to admin</a>');
  }

  // Free up the slot again
  db.prepare('UPDATE slots SET is_booked = 0 WHERE id = ?').run(booking.slot_id);
  // Remove the booking
  db.prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);

  res.redirect(`/admin?password=${password}`);
});
// Doctor login page
app.get('/doctor-login', (req, res) => {
  const html = `
    <h1>Doctor Login</h1>
    <form method="POST" action="/doctor-login">
      <label>Select Doctor:
        <select name="doctorId">
          ${db.prepare('SELECT * FROM doctors').all().map(d => `<option value="${d.id}">${d.name}</option>`).join('')}
        </select>
      </label>
      <label>Password: <input type="password" name="password" required></label>
      <button type="submit">Login</button>
    </form>
  `;
  res.send(layout('Doctor Login', html));
});

// Handle doctor login
app.post('/doctor-login', (req, res) => {
  const { doctorId, password } = req.body;
  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId);

  if (!doctor || doctor.password !== password) {
    return res.send(layout('Login Failed', '<h1>Wrong password</h1><a href="/doctor-login">Try again</a>'));
  }

  req.session.doctorId = doctor.id;
  res.redirect('/doctor-dashboard');
});

// Doctor dashboard: only their own bookings
app.get('/doctor-dashboard', (req, res) => {
  if (!req.session.doctorId) {
    return res.redirect('/doctor-login');
  }

  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(req.session.doctorId);

  const bookings = db.prepare(`
    SELECT bookings.*, slots.date, slots.time
    FROM bookings
    JOIN slots ON bookings.slot_id = slots.id
    WHERE slots.doctor_id = ?
    ORDER BY slots.date, slots.time
  `).all(req.session.doctorId);

  let html = `<h1>${doctor.name}'s Appointments</h1><table><tr><th>Patient</th><th>Contact</th><th>Date</th><th>Time</th></tr>`;
  bookings.forEach(b => {
    html += `<tr><td>${b.patient_name}</td><td>${b.patient_contact}</td><td>${b.date}</td><td>${b.time}</td></tr>`;
  });
  html += '</table><br><a href="/doctor-logout">Logout</a>';

  res.send(layout('Doctor Dashboard', html));
});

// Doctor logout
app.get('/doctor-logout', (req, res) => {
  req.session.doctorId = null;
  res.redirect('/doctor-login');
});
// Patient signup page
app.get('/signup', (req, res) => {
  const html = `
    <h1>Patient Signup</h1>
    <form method="POST" action="/signup">
      <label>Name: <input type="text" name="name" required></label>
      <label>Email: <input type="email" name="email" required></label>
      <label>Password: <input type="password" name="password" required></label>
      <button type="submit">Sign Up</button>
    </form>
    <p>Already have an account? <a href="/login">Log in</a></p>
  `;
  res.send(layout('Signup', html));
});

// Handle signup
app.post('/signup', (req, res) => {
  const { name, email, password } = req.body;

  const existing = db.prepare('SELECT * FROM patients WHERE email = ?').get(email);
  if (existing) {
    return res.send(layout('Signup Failed', '<h1>Email already registered</h1><a href="/signup">Try again</a>'));
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO patients (name, email, password) VALUES (?, ?, ?)').run(name, email, hashedPassword);

  req.session.patientId = result.lastInsertRowid;
  res.redirect('/');
});

// Patient login page
app.get('/login', (req, res) => {
  const html = `
    <h1>Patient Login</h1>
    <form method="POST" action="/login">
      <label>Email: <input type="email" name="email" required></label>
      <label>Password: <input type="password" name="password" required></label>
      <button type="submit">Log In</button>
    </form>
    <p>No account? <a href="/signup">Sign up</a></p>
  `;
  res.send(layout('Login', html));
});

// Handle login
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const patient = db.prepare('SELECT * FROM patients WHERE email = ?').get(email);

  if (!patient || !bcrypt.compareSync(password, patient.password)) {
    return res.send(layout('Login Failed', '<h1>Wrong email or password</h1><a href="/login">Try again</a>'));
  }

  req.session.patientId = patient.id;
  res.redirect('/');
});

// Patient logout
app.get('/logout', (req, res) => {
  req.session.patientId = null;
  res.redirect('/');
});

// My Bookings page
app.get('/my-bookings', (req, res) => {
  if (!req.session.patientId) {
    return res.redirect('/login');
  }

  const bookings = db.prepare(`
    SELECT bookings.*, slots.date, slots.time, doctors.name AS doctor_name
    FROM bookings
    JOIN slots ON bookings.slot_id = slots.id
    JOIN doctors ON slots.doctor_id = doctors.id
    WHERE bookings.patient_id = ?
    ORDER BY slots.date, slots.time
  `).all(req.session.patientId);

  let html = '<h1>My Bookings</h1><table><tr><th>Doctor</th><th>Date</th><th>Time</th></tr>';
  bookings.forEach(b => {
    html += `<tr><td>${b.doctor_name}</td><td>${b.date}</td><td>${b.time}</td></tr>`;
  });
  html += '</table><br><a href="/">Back to home</a>';

  res.send(layout('My Bookings', html));
});
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});