import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3001;

// CORS middleware — safe version
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // allow all origins (can restrict later)
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    // Respond to preflight request
    return res.status(204).end();
  }

  next();
});

// Enable body parsing (safe default even if we don't use body yet)
app.use(express.json());

// Postgres connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Render Postgres
});

// Ensure table exists on startup
pool.query(`
  CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    ip TEXT NOT NULL,
    date TEXT NOT NULL
  )
`).then(() => console.log("✅ Table submissions ready"))
  .catch(err => console.error("❌ Error creating table", err));

// Serve static files (front end)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// POST /dream — record dream
app.post("/dream", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const today = new Date().toISOString().split("T")[0];

  try {
    const result = await pool.query(
      "SELECT 1 FROM submissions WHERE ip = $1 AND date = $2",
      [ip, today]
    );

    if (result.rowCount > 0) {
      return res.status(400).json({ message: "You already flagged a dream today." });
    }

    await pool.query(
      "INSERT INTO submissions (ip, date) VALUES ($1, $2)",
      [ip, today]
    );

    // Correct response — this WILL be parsed fine by your front-end
    res.status(200).json({ message: "Weird dream recorded. Thanks!" });
  } catch (err) {
    console.error("❌ Error in /dream", err);
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

  // If we have a cached result and it's still fresh, return it
  if (cachedStats && (now - cacheTime) < CACHE_DURATION_MS) {
    console.log("✅ Serving cached /dream-stats");
    return res.status(200).json(cachedStats);
  }

  // Otherwise fetch fresh data from DB — past 365 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 364); // today + 364 days back = 365 days total
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

    const stats = result.rows.map(r => ({
      date: r.date,
      count: parseInt(r.count, 10),
    }));

    // Update cache
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
