import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

export default async function handler(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT
        code,
        title,
        gr_date::text AS gr_date
      FROM historical_grs
      ORDER BY gr_date DESC NULLS LAST, code DESC
    `);

    res.status(200).json(rows);
  } catch (err) {
    console.error("Database error:", err);

    res.status(500).json({
      error: "Failed to fetch GRs",
    });
  }
}