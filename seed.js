import pg from "pg";
import https from "https";

// ── Config ────────────────────────────────────────────────────────────────────
// Use environment variables for the DB connection. Do NOT commit real credentials.
const DB_URL =
  process.env.PG_CONNECTION_STRING ||
  process.env.DATABASE_URL ||
  `postgresql://${process.env.PG_USER || "postgres"}:${process.env.PG_PASSWORD || ""}@${process.env.PG_HOST || "localhost"}:${process.env.PG_PORT || 5432}/${process.env.PG_DATABASE || "EDUGR"}`;
const REPO     = "orgpedia/mahGRs";
const DEPT     = "Higher_and_Technical_Education_Department";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/GRs/${DEPT}`;

const CONCURRENCY = 5;   // parallel fetches at a time 
const DELAY_MS    = 100; // small pause between batches

// ── Helpers ───────────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { "User-Agent": "gr-seed-script" } };
    https.get(url, options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode} — ${url}`));
      });
    }).on("error", reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractTitle(rawText) {
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);

  // Find "# Page 1" marker
  const startIdx = lines.findIndex(l => l.startsWith("# Page 1"));
  if (startIdx === -1) return "—";

  // Collect lines after "# Page 1" until "Government of Maharashtra"
  const titleLines = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^government of maharashtra/i.test(lines[i])) break;
    titleLines.push(lines[i]);
  }

  const title = titleLines.join(" ").trim();
  return title.slice(0, 500) || "—";
}

function extractCode(filename) {
  return filename.split(".")[0];
}

async function processBatch(files, client, stats) {
  await Promise.all(files.map(async (file) => {
    const code = extractCode(file);
    try {
      const raw = await get(`${RAW_BASE}/${file}`);
      const title = extractTitle(raw);
      await client.query(
        `INSERT INTO gr_index (code, title)
         VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title`,
        [code, title]
      );
      stats.done++;
      process.stdout.write(`\r  ${stats.done}/${stats.total} processed...`);
    } catch (err) {
      stats.failed++;
      console.error(`\n  ✗ ${file}: ${err.message}`);
    }
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("── Maharashtra GR Index Seed ────────────────────");

  // 1. Fetch full repo tree (no 1000-file limit)
  console.log("\n1. Fetching file list via Git Tree API...");
  const treeUrl = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;
  const treeJson = await get(treeUrl);
  const tree = JSON.parse(treeJson);

  const files = tree.tree
    .filter(f => f.path.startsWith(`GRs/${DEPT}/`) && f.path.endsWith(".pdf.en.txt"))
    .map(f => f.path.split("/").pop());

  console.log(`   Found ${files.length} files`);

  // 2. Connect to Postgres
  console.log("\n2. Connecting to Postgres...");
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  console.log("   Connected ✓");

  // 3. Ensure table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS gr_index (
      code  TEXT PRIMARY KEY,
      title TEXT NOT NULL
    )
  `);

  // 4. Seed in batches
  console.log(`\n3. Seeding ${files.length} GRs (${CONCURRENCY} at a time)...\n`);
  const stats = { done: 0, failed: 0, total: files.length };

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    await processBatch(batch, client, stats);
    if (i + CONCURRENCY < files.length) await sleep(DELAY_MS);
  }

  // 5. Summary
  const { rows } = await client.query("SELECT COUNT(*) FROM gr_index");
  await client.end();

  console.log(`\n\n── Done ──────────────────────────────────────────`);
  console.log(`   Processed : ${stats.done}`);
  console.log(`   Failed    : ${stats.failed}`);
  console.log(`   Total rows: ${rows[0].count}`);
}

main().catch(err => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});