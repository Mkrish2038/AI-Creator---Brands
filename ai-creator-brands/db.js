// Data storage.
// - If DATABASE_URL is set  -> PostgreSQL (use this online; free on Neon or Supabase)
// - Otherwise               -> a local JSON file (data/db.json) for testing on your computer
const fs = require('fs');
const path = require('path');

let store;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const toUser = (r) => r && { ...r, id: Number(r.id) };
  const toOtp = (r) =>
    r && {
      email: r.email,
      role: r.role,
      codeHash: r.code_hash,
      expiresAt: Number(r.expires_at),
      attempts: r.attempts,
      lastSentAt: Number(r.last_sent_at),
    };

  store = {
    mode: 'PostgreSQL',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id BIGSERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('creator','brand')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_login TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS otps (
          email TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          expires_at BIGINT NOT NULL,
          attempts INT NOT NULL DEFAULT 0,
          last_sent_at BIGINT NOT NULL
        );
      `);
    },
    async getUser(email) {
      const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
      return toUser(r.rows[0]);
    },
    async createUser(email, role) {
      const r = await pool.query(
        'INSERT INTO users(email, role, last_login) VALUES ($1,$2, now()) RETURNING *',
        [email, role]
      );
      return toUser(r.rows[0]);
    },
    async touchLogin(id) {
      await pool.query('UPDATE users SET last_login = now() WHERE id=$1', [id]);
    },
    async saveOtp({ email, role, codeHash, expiresAt, lastSentAt }) {
      await pool.query(
        `INSERT INTO otps(email, role, code_hash, expires_at, attempts, last_sent_at)
         VALUES ($1,$2,$3,$4,0,$5)
         ON CONFLICT (email) DO UPDATE SET
           role=$2, code_hash=$3, expires_at=$4, attempts=0, last_sent_at=$5`,
        [email, role, codeHash, expiresAt, lastSentAt]
      );
    },
    async getOtp(email) {
      const r = await pool.query('SELECT * FROM otps WHERE email=$1', [email]);
      return toOtp(r.rows[0]);
    },
    async addAttempt(email) {
      await pool.query('UPDATE otps SET attempts = attempts + 1 WHERE email=$1', [email]);
    },
    async deleteOtp(email) {
      await pool.query('DELETE FROM otps WHERE email=$1', [email]);
    },
  };
} else {
  const file = path.join(__dirname, 'data', 'db.json');
  let db = { users: [], otps: {}, nextId: 1 };
  const save = () => fs.writeFileSync(file, JSON.stringify(db, null, 2));

  store = {
    mode: 'local file (data/db.json)',
    async init() {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8'));
      else save();
    },
    async getUser(email) {
      return db.users.find((u) => u.email === email) || null;
    },
    async createUser(email, role) {
      const now = new Date().toISOString();
      const user = { id: db.nextId++, email, role, created_at: now, last_login: now };
      db.users.push(user);
      save();
      return user;
    },
    async touchLogin(id) {
      const u = db.users.find((x) => x.id === id);
      if (u) u.last_login = new Date().toISOString();
      save();
    },
    async saveOtp({ email, role, codeHash, expiresAt, lastSentAt }) {
      db.otps[email] = { email, role, codeHash, expiresAt, attempts: 0, lastSentAt };
      save();
    },
    async getOtp(email) {
      return db.otps[email] || null;
    },
    async addAttempt(email) {
      if (db.otps[email]) db.otps[email].attempts++;
      save();
    },
    async deleteOtp(email) {
      delete db.otps[email];
      save();
    },
  };
}

module.exports = store;
