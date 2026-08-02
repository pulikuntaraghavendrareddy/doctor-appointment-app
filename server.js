require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('./database');
const app = express();
const PORT = process.env.PORT || 3000;

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
app.get('/', async (req, res) => {
  const result = await db.query('SELECT * FROM doctors');
  const doctors = result.rows;

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
app.get('/doctor/:id', async (req, res) => {
  const doctorId = req.params.id;
  const doctorResult = await db.query('SELECT * FROM doctors WHERE id = $1', [doctorId]);
  const doctor = doctorResult.rows[0];

  if (!doctor) {
    return res.send(layout('Not Found', '<h1>Doctor not found</h1><a href="/">Back to home</a>'));
  }

  const slotsResult = await db.query('SELECT * FROM slots WHERE doctor_id = $1 AND is_booked = 0', [doctorId]);
  const slots = slotsResult.rows;

  let html = `<h1>${doctor.name} — ${doctor.specialty}</h1>`;
  html += '<h2>Available Slots</h2><ul>';
  slots.forEach(slot => {
    html += `<li>${slot.date} at ${slot.time} — <a href="/book/${slot.id}">Book this slot</a></li>`;
  });
  html += '</ul><a href="/">Back to home</a>';

  res.send(layout(doctor.name, html));
});

// Show booking form for a specific slot
app.get('/book/:id', async (req, res) => {
  const slotId = req.params.id;
  const result = await db.query(`
    SELECT slots.*, doctors.name AS doctor_name
    FROM slots
    JOIN doctors ON slots.doctor_id = doctors.id
    WHERE slots.id = $1
  `, [slotId]);
  const slot = result.rows[0];

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
app.post('/book/:id', async (req, res) => {
  const slotId = req.params.id;
  const { patient_name, patient_contact } = req.body;

  const slotResult = await db.query('SELECT * FROM slots WHERE id = $1', [slotId]);
  const slot = slotResult.rows[0];
  if (!slot || slot.is_booked) {
    return res.send(layout('Unavailable', '<h1>Sorry, this slot is unavailable</h1><a href="/">Back to home</a>'));
  }

  const patientId = req.session.patientId || null;
  await db.query(
    'INSERT INTO bookings (slot_id, patient_name, patient_contact, patient_id) VALUES ($1, $2, $3, $4)',
    [slotId, patient_name, patient_contact, patientId]
  );

  await db.query('UPDATE slots SET is_booked = 1 WHERE id = $1', [slotId]);

  const doctorResult = await db.query('SELECT name FROM doctors WHERE id = $1', [slot.doctor_id]);
  const doctorName = doctorResult.rows[0].name;

  if (patient_contact.includes('@')) {
    transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: patient_contact,
      subject: 'Appointment Confirmed',
      text: `Hi ${patient_name},\n\nYour appointment with ${doctorName} on ${slot.date} at ${slot.time} is confirmed.\n\nThanks!`
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
app.get('/admin', async (req, res) => {
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

  const result = await db.query(`
    SELECT bookings.*, slots.date, slots.time, doctors.name AS doctor_name
    FROM bookings
    JOIN slots ON bookings.slot_id = slots.id
    JOIN doctors ON slots.doctor_id = doctors.id
    ORDER BY slots.date, slots.time
  `);
  const bookings = result.rows;

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
app.post('/admin/cancel/:bookingId', async (req, res) => {
  const bookingId = req.params.bookingId;
  const password = req.body.password;

  if (password !== 'admin123') {
    return res.send('<h1>Not authorized</h1><a href="/admin">Back to admin</a>');
  }

  const bookingResult = await db.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  const booking = bookingResult.rows[0];
  if (!booking) {
    return res.send('<h1>Booking not found</h1><a href="/admin">Back to admin</a>');
  }

  await db.query('UPDATE slots SET is_booked = 0 WHERE id = $1', [booking.slot_id]);
  await db.query('DELETE FROM bookings WHERE id = $1', [bookingId]);

  res.redirect(`/admin?password=${password}`);
});



// Doctor dashboard: only their own bookings
app.get('/doctor-dashboard', async (req, res) => {
  if (!req.session.doctorId) {
    return res.redirect('/doctor-login');
  }

  const doctorResult = await db.query('SELECT * FROM doctors WHERE id = $1', [req.session.doctorId]);
  const doctor = doctorResult.rows[0];

  const bookingsResult = await db.query(`
    SELECT bookings.*, slots.date, slots.time
    FROM bookings
    JOIN slots ON bookings.slot_id = slots.id
    WHERE slots.doctor_id = $1
    ORDER BY slots.date, slots.time
  `, [req.session.doctorId]);

  let html = `<h1>${doctor.name}'s Dashboard</h1>`;

  html += `
    <h2>Add a New Slot</h2>
    <form method="POST" action="/doctor-dashboard/add-slot">
      <label>Date: <input type="date" name="date" required></label>
      <label>Time: <input type="text" name="time" placeholder="e.g. 10:00 AM" required></label>
      <button type="submit">Add Slot</button>
    </form>
  `;

  html += '<h2>Your Appointments</h2><table><tr><th>Patient</th><th>Contact</th><th>Date</th><th>Time</th></tr>';
  bookingsResult.rows.forEach(b => {
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
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  const existingResult = await db.query('SELECT * FROM patients WHERE email = $1', [email]);
  if (existingResult.rows[0]) {
    return res.send(layout('Signup Failed', '<h1>Email already registered</h1><a href="/signup">Try again</a>'));
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const result = await db.query(
    'INSERT INTO patients (name, email, password) VALUES ($1, $2, $3) RETURNING id',
    [name, email, hashedPassword]
  );

  req.session.patientId = result.rows[0].id;
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
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await db.query('SELECT * FROM patients WHERE email = $1', [email]);
  const patient = result.rows[0];

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
app.get('/my-bookings', async (req, res) => {
  if (!req.session.patientId) {
    return res.redirect('/login');
  }

  const result = await db.query(`
    SELECT bookings.*, slots.date, slots.time, doctors.name AS doctor_name
    FROM bookings
    JOIN slots ON bookings.slot_id = slots.id
    JOIN doctors ON slots.doctor_id = doctors.id
    WHERE bookings.patient_id = $1
    ORDER BY slots.date, slots.time
  `, [req.session.patientId]);

  let html = '<h1>My Bookings</h1><table><tr><th>Doctor</th><th>Date</th><th>Time</th></tr>';
  result.rows.forEach(b => {
    html += `<tr><td>${b.doctor_name}</td><td>${b.date}</td><td>${b.time}</td></tr>`;
  });
  html += '</table><br><a href="/">Back to home</a>';

  res.send(layout('My Bookings', html));
});

// Doctor signup page
app.get('/doctor-signup', (req, res) => {
  const html = `
    <h1>Doctor Signup</h1>
    <form method="POST" action="/doctor-signup">
      <label>Full Name: <input type="text" name="name" required></label>
      <label>Specialty: <input type="text" name="specialty" required></label>
      <label>Email: <input type="email" name="email" required></label>
      <label>Password: <input type="password" name="password" required></label>
      <button type="submit">Sign Up</button>
    </form>
    <p>Already have an account? <a href="/doctor-login">Log in</a></p>
  `;
  res.send(layout('Doctor Signup', html));
});

// Handle doctor signup
app.post('/doctor-signup', async (req, res) => {
  const { name, specialty, email, password } = req.body;

  const existing = await db.query('SELECT * FROM doctors WHERE email = $1', [email]);
  if (existing.rows[0]) {
    return res.send(layout('Signup Failed', '<h1>Email already registered</h1><a href="/doctor-signup">Try again</a>'));
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const result = await db.query(
    'INSERT INTO doctors (name, specialty, email, password) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, specialty, email, hashedPassword]
  );

  req.session.doctorId = result.rows[0].id;
  res.redirect('/doctor-dashboard');
});
// Doctor login page
app.get('/doctor-login', (req, res) => {
  const html = `
    <h1>Doctor Login</h1>
    <form method="POST" action="/doctor-login">
      <label>Email: <input type="email" name="email" required></label>
      <label>Password: <input type="password" name="password" required></label>
      <button type="submit">Log In</button>
    </form>
    <p>No account? <a href="/doctor-signup">Sign up</a></p>
  `;
  res.send(layout('Doctor Login', html));
});

// Handle doctor login
app.post('/doctor-login', async (req, res) => {
  const { email, password } = req.body;
  const result = await db.query('SELECT * FROM doctors WHERE email = $1', [email]);
  const doctor = result.rows[0];

  if (!doctor || !bcrypt.compareSync(password, doctor.password)) {
    return res.send(layout('Login Failed', '<h1>Wrong email or password</h1><a href="/doctor-login">Try again</a>'));
  }

  req.session.doctorId = doctor.id;
  res.redirect('/doctor-dashboard');
});
// Doctor adds a new slot
app.post('/doctor-dashboard/add-slot', async (req, res) => {
  if (!req.session.doctorId) {
    return res.redirect('/doctor-login');
  }

  const { date, time } = req.body;

  await db.query(
    'INSERT INTO slots (doctor_id, date, time) VALUES ($1, $2, $3)',
    [req.session.doctorId, date, time]
  );

  res.redirect('/doctor-dashboard');
});
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});