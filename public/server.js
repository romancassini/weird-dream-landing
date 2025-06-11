/* server.js — minimal Express back end */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app  = express();
const PORT = process.env.PORT || 3001;

/* serve static front-end */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

/* in-memory store (replace with DB later) */
const submissions = [];          // { ip, date }
const today = () => new Date().toISOString().split("T")[0];

/* POST /dream  – one click per IP per day */
app.post("/dream", (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const d  = today();

  if (submissions.find((s) => s.ip === ip && s.date === d)) {
    return res.status(400).json({ message: "You already flagged a dream today." });
  }
  submissions.push({ ip, date: d });
  res.json({ message: "Weird dream recorded. Thanks!" });
});

/* GET /dream-stats  – last 14 days counts */
app.get("/dream-stats", (_, res) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 13);  // today + 13 back = 14 days

  const tally = {};
  submissions.forEach(({ date }) => {
    if (new Date(date) >= cutoff) tally[date] = (tally[date] || 0) + 1;
  });

  const data = Object.keys(tally)
    .sort()
    .map((d) => ({ date: d, count: tally[d] }));

  res.json(data);
});

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
