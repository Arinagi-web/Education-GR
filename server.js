import 'dotenv/config';
import express from "express";
import cors from "cors";
import pg from "pg";
const { Pool } = pg;

const app  = express();
const PORT = 3001;

// Prefer a single connection string (e.g. from hosting). Fallback to
// individual PG_* env vars. Do NOT hardcode credentials here.
const dbConfig = process.env.POSTGRES_URL
  ? { connectionString: process.env.POSTGRES_URL }
  : process.env.PG_CONNECTION_STRING
  ? { connectionString: process.env.PG_CONNECTION_STRING }
  : process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      host: process.env.PG_HOST,
      port: process.env.PG_PORT
        ? Number(process.env.PG_PORT)
        : undefined,
      database: process.env.PG_DATABASE,
    };

const pool = new Pool(dbConfig);

app.use(cors());
app.use(express.json());

// GET /api/grs — all GRs from both tables
app.get("/api/grs", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        code,
        title,
        gr_date::text AS gr_date
      FROM historical_grs

      ORDER BY gr_date DESC NULLS LAST, code DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
});