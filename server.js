import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 3001;

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// JSON body parsing
app.use(express.json());

// Postgres connection
global.__basedir = process.cwd();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Ensure dream_text column exists (migration)
pool.query(
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS dream_text TEXT;`
).then(() => console.log("✅ Column dream_text ensured"))
.catch(err => console.error("⚠️ Error ensuring dream_text column:", err));

// Ensure table exists on startup
pool.query(`
  CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    ip TEXT NOT NULL,
    date TEXT NOT NULL
  )
`).then(() => console.log("✅ Table submissions ready"))
.catch(err => console.error("❌ Error creating table", err));

// Serve static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// POST /dream — record dream count
app.post("/dream", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const today = new Date().toISOString().split("T")[0];
  try {
    const exists = await pool.query(
      "SELECT 1 FROM submissions WHERE ip = $1 AND date = $2",
      [ip, today]
    );
    if (exists.rowCount > 0) {
      return res.status(400).json({ message: "You already flagged a dream today." });
    }
    await pool.query(
      "INSERT INTO submissions (ip, date) VALUES ($1, $2)",
      [ip, today]
    );
    res.status(200).json({ message: "Weird dream recorded. Thanks!" });
  } catch (err) {
    console.error("❌ Error in /dream", err);
    res.status(500).json({ message: "Server error." });
  }
});

// POST /dream-text — record user keywords
app.post("/dream-text", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const today = new Date().toISOString().split("T")[0];
  const { dreamText } = req.body;
  try {
    await pool.query(
      "INSERT INTO submissions (ip, date, dream_text) VALUES ($1, $2, $3)",
      [ip, today, dreamText]
    );
    res.status(200).json({ message: "Keywords recorded. Thanks!" });
  } catch (err) {
    console.error("❌ Error in /dream-text", err);
    res.status(500).json({ message: "Server error." });
  }
});

// Caching for /dream-stats
let cachedStats = null;
let cacheTime = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// GET /dream-stats — return past 365 days counts
app.get("/dream-stats", async (_, res) => {
  const now = Date.now();
  if (cachedStats && (now - cacheTime) < CACHE_DURATION_MS) {
    console.log("✅ Serving cached /dream-stats");
    return res.status(200).json(cachedStats);
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 364);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  try {
    const result = await pool.query(
      `
      SELECT date, COUNT(*) AS count
      FROM submissions
      WHERE date >= $1
      GROUP BY date
      ORDER BY date ASC
      `,
      [cutoffStr]
    );
    const stats = result.rows.map(r => ({ date: r.date, count: parseInt(r.count, 10) }));
    cachedStats = stats;
    cacheTime = now;
    console.log("🔄 Fetched fresh /dream-stats from DB");
    res.status(200).json(stats);
  } catch (err) {
    console.error("❌ Error in /dream-stats", err);
    res.status(500).json({ message: "Server error." });
  }
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));

// DEBUG: fetch keywords for a given date (word cloud data)
app.get("/dream-texts", async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "Missing date parameter" });
  try {
    const result = await pool.query(
      `SELECT dream_text FROM submissions WHERE date = $1 AND dream_text IS NOT NULL ORDER BY id ASC`,
      [date]
    );
    res.json(result.rows.map(r => r.dream_text));
  } catch (err) {
    console.error("❌ Error in /dream-texts", err);
    res.status(500).json({ error: "Server error." });
  }
});
