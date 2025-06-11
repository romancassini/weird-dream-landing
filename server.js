import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3001;

// Postgres connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },  // required on Render hosted Postgres
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

    res.json({ message: "Weird dream recorded. Thanks!" });
  } catch (err) {
    console.error("❌ Error in /dream", err);
    res.status(500).json({ message: "Server error." });
  }
});

// GET /dream-stats — return last 14 days counts
app.get("/dream-stats", async (_, res) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 13); // today + 13 days back = 14 days
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

    res.json(result.rows.map(r => ({
      date: r.date,
      count: parseInt(r.count, 10),
    })));
  } catch (err) {
    console.error("❌ Error in /dream-stats", err);
    res.status(500).json({ message: "Server error." });
  }
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));
