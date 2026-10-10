require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { sendOtpEmail } = require('./mailer');

const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD && !process.env.JWT_SECRET) {
  throw new Error('Set JWT_SECRET in your environment variables before running online.');
}
const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

const OTP_TTL_MS = 5 * 60 * 1000; // code valid for 5 minutes
const RESEND_WAIT_MS = 60 * 1000; // 60 seconds between codes
const MAX_ATTEMPTS = 5; // wrong guesses allowed per code
const ROLES = { creator: 'AI Creator', brand: 'Brand' };

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// ---------- helpers ----------
const hashOtp = (email, code) =>
  crypto.createHmac('sha256', SECRET).update(`${email}:${code}`).digest('hex');

const isEmail = (s) =>
  typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

function getSession(req) {
  try {
    return jwt.verify(req.cookies.session, SECRET);
  } catch {
    return null;
  }
}

function requireRole(role) {
  return (req, res, next) => {
    const s = getSession(req);
    if (!s) return res.redirect(`/login.html?role=${role}`);
    if (s.role !== role) return res.redirect(s.role === 'creator' ? '/creator-dashboard' : '/brand-dashboard');
    req.user = s;
    next();
  };
}

// ---------- API ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

// Step 1: ask for a code
app.post('/api/auth/request-otp', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = req.body.role;

    if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!ROLES[role]) return res.status(400).json({ error: 'Choose AI Creator or Brand first.' });

    const user = await db.getUser(email);
    if (user && user.role !== role) {
      return res.status(409).json({
        error: `This email is already registered as ${ROLES[user.role]}. Go back and choose ${ROLES[user.role]}.`,
      });
    }

    const existing = await db.getOtp(email);
    const now = Date.now();
    if (existing && now - existing.lastSentAt < RESEND_WAIT_MS) {
      const wait = Math.ceil((RESEND_WAIT_MS - (now - existing.lastSentAt)) / 1000);
      return res.status(429).json({ error: `Wait ${wait}s before asking for a new code.`, wait });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await db.saveOtp({
      email,
      role,
      codeHash: hashOtp(email, code),
      expiresAt: now + OTP_TTL_MS,
      lastSentAt: now,
    });

    await sendOtpEmail(email, code, ROLES[role]);
    res.json({ ok: true, resendIn: RESEND_WAIT_MS / 1000 });
  } catch (err) {
    console.error('request-otp failed:', err.message);
    res.status(500).json({ error: 'Could not send the code. Please try again.' });
  }
});

// Step 2: check the code and log in
app.post('/api/auth/verify-otp', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.otp || '').trim();
    const role = req.body.role;

    if (!isEmail(email) || !ROLES[role] || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the 6-digit code.' });
    }

    const record = await db.getOtp(email);
    if (!record || record.role !== role || Date.now() > record.expiresAt) {
      return res.status(400).json({ error: 'This code has expired. Ask for a new one.' });
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      await db.deleteOtp(email);
      return res.status(429).json({ error: 'Too many wrong codes. Ask for a new one.' });
    }

    const a = Buffer.from(hashOtp(email, code));
    const b = Buffer.from(record.codeHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      await db.addAttempt(email);
      const left = MAX_ATTEMPTS - record.attempts - 1;
      return res.status(400).json({ error: `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left.` });
    }

    await db.deleteOtp(email); // a code works only once

    let user = await db.getUser(email);
    if (!user) user = await db.createUser(email, role);
    else await db.touchLogin(user.id);

    const token = jwt.sign({ uid: user.id, email: user.email, role: user.role }, SECRET, { expiresIn: '7d' });
    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true, redirect: role === 'creator' ? '/creator-dashboard' : '/brand-dashboard' });
  } catch (err) {
    console.error('verify-otp failed:', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/me', (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Not logged in' });
  res.json({ email: s.email, role: s.role, roleLabel: ROLES[s.role] });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

// ---------- pages ----------
// Dashboards live in /private so they cannot be opened without logging in.
app.get('/creator-dashboard', requireRole('creator'), (req, res) =>
  res.sendFile(path.join(__dirname, 'private', 'creator-dashboard.html'))
);
app.get('/brand-dashboard', requireRole('brand'), (req, res) =>
  res.sendFile(path.join(__dirname, 'private', 'brand-dashboard.html'))
);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- start ----------
const PORT = process.env.PORT || 3000;
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\nAI Creator - Brands is running`);
      console.log(`Storage : ${db.mode}`);
      console.log(`Email   : ${process.env.BREVO_API_KEY ? 'Brevo (real emails)' : 'TEST MODE (OTP printed here)'}`);
      console.log(`Open    : http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error('Database failed to start:', err.message);
    process.exit(1);
  });
