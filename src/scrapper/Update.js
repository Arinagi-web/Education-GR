import { chromium } from "playwright";
import pg from "pg";

// ============================================================
// DATABASE
// ============================================================

// Load DB connection from environment variables. Prefer a single
// connection string to avoid hardcoding secrets.
const pool = new pg.Pool(
  process.env.PG_CONNECTION_STRING
    ? { connectionString: process.env.PG_CONNECTION_STRING }
    : process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        user: process.env.PG_USER || "postgres",
        password: process.env.PG_PASSWORD,
        host: process.env.PG_HOST || "localhost",
        port: process.env.PG_PORT ? Number(process.env.PG_PORT) : 5432,
        database: process.env.PG_DATABASE || "EDUGR",
      }
);

// ============================================================
// GOVERNMENT PORTAL
// ============================================================

const PAGE_URL =
  "https://gr.maharashtra.gov.in/1145/Government-Resolutions";

const SELECTORS = {
  language: "#HeaderMain1_SetCulture1_btn_Language",
  table: "#SitePH_dgvDocuments",
  pageInfo: "#SitePH_ucPaging_pnlPageNo",
  nextPage: "#SitePH_ucPaging_lnkNext",
};

// ============================================================
// SETTINGS
// ============================================================

const PAGE_DELAY_MS = 2000;

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function parsePortalDate(dateText) {
  // Portal format: DD-MM-YYYY

  const parts = dateText
    .trim()
    .split("-");

  if (parts.length !== 3) {
    return null;
  }

  const [day, month, year] = parts;

  return `${year}-${month}-${day}`;
}

function formatDate(isoDate) {
  const [year, month, day] =
    isoDate.split("-");

  const months = [
    "Jan", "Feb", "Mar", "Apr",
    "May", "Jun", "Jul", "Aug",
    "Sep", "Oct", "Nov", "Dec"
  ];

  return `${day} ${months[Number(month) - 1]} ${year}`;
}

// ============================================================
// GET LATEST DATABASE DATE
// ============================================================

async function getLatestDate() {
  const result = await pool.query(`
    SELECT MAX(gr_date)::text AS latest_date
    FROM historical_grs
  `);

  if (!result.rows[0].latest_date) {
    throw new Error(
      "No GR date found in historical_grs."
    );
  }

  return result.rows[0].latest_date;
}

// ============================================================
// GET EXISTING CODES
// ============================================================

async function getExistingCodes() {
  const result = await pool.query(`
    SELECT code
    FROM historical_grs
  `);

  return new Set(
    result.rows.map(row => row.code)
  );
}

// ============================================================
// GET TODAY
// ============================================================

function getToday() {
  const now = new Date();

  return now.toISOString().slice(0, 10);
}

// ============================================================
// GET TOTAL PAGES
// ============================================================

async function getPageInfo(page) {
  const text =
    await page
      .locator(SELECTORS.pageInfo)
      .innerText();

  const match =
    text.match(/\/\s*(\d+)/);

  if (!match) {
    throw new Error(
      `Could not determine total pages from: "${text}"`
    );
  }

  return Number(match[1]);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  let browser;

  try {
    console.log(
      "=============================================="
    );

    console.log(
      "GR DATABASE UPDATE"
    );

    console.log(
      "=============================================="
    );

    // ========================================================
    // DATABASE
    // ========================================================

    console.log(
      "\nChecking current database..."
    );

    const fromDate =
      await getLatestDate();

    const toDate =
      getToday();

    const existingCodes =
      await getExistingCodes();

    console.log(
      `✓ Latest GR date in database: ${formatDate(fromDate)}`
    );

    console.log(
      `✓ Today's date: ${formatDate(toDate)}`
    );

    console.log(
      `✓ Existing GR codes loaded: ${existingCodes.size}`
    );

    console.log(
      `\nScraping GRs from ${formatDate(fromDate)} to ${formatDate(toDate)}`
    );

    // ========================================================
    // OPEN PORTAL
    // ========================================================

    console.log(
      "\nOpening Government Resolution portal..."
    );

    browser =
      await chromium.launch({
        headless: false,
        slowMo: 150,
      });

    const page =
      await browser.newPage();

    await page.goto(
      PAGE_URL,
      {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }
    );

    console.log(
      "✓ Portal opened."
    );

    // ========================================================
    // SWITCH TO ENGLISH
    // ========================================================

    console.log(
      "\nSwitching to English..."
    );

    await page.click(
      SELECTORS.language
    );

    await page
      .waitForLoadState("networkidle")
      .catch(() => {});

    console.log(
      "✓ English selected."
    );

    // ========================================================
    // WAIT FOR TABLE
    // ========================================================

    await page
      .locator(SELECTORS.table)
      .waitFor({
        state: "visible",
        timeout: 30000,
      });

    // ========================================================
    // GET TOTAL PAGES
    // ========================================================

    const totalPages =
      await getPageInfo(page);

    console.log(
      `\nTotal Pages available: ${totalPages}`
    );

    // ========================================================
    // RESULTS
    // ========================================================

    const matchingGRs = [];

    const newGRs = [];

    const existingGRs = [];

    let pagesScraped = 0;

    // ========================================================
    // PAGINATION
    // ========================================================

    for (
      let currentPage = 1;
      currentPage <= totalPages;
      currentPage++
    ) {
      console.log(
        "\n=============================================="
      );

      console.log(
        `Scraping page ${currentPage}/${totalPages}...`
      );

      console.log(
        "=============================================="
      );

      const rows =
        page.locator(
          `${SELECTORS.table} tr`
        );

      const rowCount =
        await rows.count();
        if (rowCount <= 1) {
            console.log(
                "⚠ Page contains no data rows."
            );

            console.log(
                "⚠ This will NOT be treated as the end of the data."
            );

            throw new Error(
                `Page ${currentPage} loaded without data rows.`
            );
        }

      let pageMatchingGRs = 0;

      let pageHasRelevantDate = false;

      // ======================================================
      // READ ROWS
      // ======================================================

      for (
        let i = 1;
        i < rowCount;
        i++
      ) {
        const row =
          rows.nth(i);

        const cells =
          row.locator("td");

        if (
          (await cells.count()) < 5
        ) {
          continue;
        }

        // ----------------------------------------------------
        // COLUMNS
        // ----------------------------------------------------
        //
        // 0 = SN
        // 1 = Department Name
        // 2 = Title
        // 3 = Unique Code
        // 4 = G.R. Date
        // 5 = File Size
        // 6 = Download
        //

        const department =
          (
            await cells
              .nth(1)
              .innerText()
          ).trim();

        const title =
          (
            await cells
              .nth(2)
              .innerText()
          ).trim();

        const code =
          (
            await cells
              .nth(3)
              .innerText()
          ).trim();

        const portalDate =
          (
            await cells
              .nth(4)
              .innerText()
          ).trim();

        const grDate =
          parsePortalDate(
            portalDate
          );

        if (!grDate) {
          console.log(
            `⚠ Could not parse date: ${portalDate}`
          );

          continue;
        }

        // ----------------------------------------------------
        // DATE RANGE TRACKING
        // ----------------------------------------------------

        if (
          grDate >= fromDate
        ) {
          pageHasRelevantDate = true;
        }

        // ----------------------------------------------------
        // DEPARTMENT CHECK
        // ----------------------------------------------------

        if (
          department !==
          "Higher and Technical Education Department"
        ) {
          continue;
        }

        // ----------------------------------------------------
        // DATE CHECK
        // ----------------------------------------------------

        if (
          grDate < fromDate ||
          grDate > toDate
        ) {
          continue;
        }

        // ----------------------------------------------------
        // PDF URL
        // ----------------------------------------------------

        let pdfUrl = null;

        const link =
          await row
            .locator("a")
            .getAttribute("href");

        if (link) {
          pdfUrl =
            new URL(
              link,
              PAGE_URL
            ).href;
        }

        // ----------------------------------------------------
        // MATCHING RECORD
        // ----------------------------------------------------

        const record = {
          department,
          title,
          code,
          grDate,
          pdfUrl,
        };

        matchingGRs.push(record);

        pageMatchingGRs++;

        // ----------------------------------------------------
        // DATABASE COMPARISON
        // ----------------------------------------------------

        if (
          existingCodes.has(code)
        ) {
          existingGRs.push(record);
        } else {
          newGRs.push(record);

          // Prevent the same code from being
          // considered new again if it appears
          // more than once on the portal.
          existingCodes.add(code);
        }
      }

      pagesScraped++;

      // ======================================================
      // PAGE SUMMARY
      // ======================================================

      console.log(
        `✓ Total GRs on page       : ${rowCount - 1}`
      );

      console.log(
        `✓ Matching GRs on page    : ${pageMatchingGRs}`
      );

      console.log(
        `✓ Running total           : ${matchingGRs.length}`
      );

      // ======================================================
      // STOP CONDITION
      // ======================================================

      if (
        !pageHasRelevantDate
      ) {
        console.log(
          "\n✓ This page contains no GRs on or after the database date."
        );

        console.log(
          "✓ Older pages do not need to be inspected."
        );

        break;
      }

      // ======================================================
      // LAST PAGE
      // ======================================================

      if (
        currentPage === totalPages
      ) {
        break;
      }

      // ======================================================
      // POLITE DELAY
      // ======================================================

      console.log(
        `\nWaiting ${PAGE_DELAY_MS} ms before next page...`
      );

      await sleep(
        PAGE_DELAY_MS
      );

      // ======================================================
      // NEXT PAGE
      // ======================================================

      console.log(
        `Moving to page ${currentPage + 1}...`
      );

        await page.click(
        SELECTORS.nextPage
        );

        // Wait until the first actual data row
        // appears on the new page.
        await page
        .locator(
            `${SELECTORS.table} tr`
        )
        .nth(1)
        .waitFor({
            state: "visible",
            timeout: 30000,
        });

        console.log(
        `✓ Page ${currentPage + 1} loaded.`
        );
    }

    // ========================================================
    // DATABASE COMPARISON SUMMARY
    // ========================================================

    console.log(
      "\n=============================================="
    );

    console.log(
      "DATABASE COMPARISON"
    );

    console.log(
      "=============================================="
    );

    console.log(
      `Scraped matching GRs : ${matchingGRs.length}`
    );

    console.log(
      `Already in database  : ${existingGRs.length}`
    );

    console.log(
      `New GRs              : ${newGRs.length}`
    );

    console.log(
      "=============================================="
    );

    // ========================================================
    // SHOW NEW GRs
    // ========================================================

    if (
      newGRs.length > 0
    ) {
      console.log(
        "\nNEW GRs"
      );

      console.log(
        "=============================================="
      );

      for (
        const gr of newGRs
      ) {
        console.log(
          `\nTitle      : ${gr.title}`
        );

        console.log(
          `Unique Code: ${gr.code}`
        );

        console.log(
          `GR Date    : ${formatDate(gr.grDate)}`
        );

        console.log(
          `PDF URL    : ${gr.pdfUrl || "Not found"}`
        );

        console.log(
          "----------------------------------------------"
        );
      }
    } else {
      console.log(
        "\n✓ No new GRs found."
      );
    }

    // ========================================================
    // SAVE CONFIRMATION
    // ========================================================

    if (
      newGRs.length === 0
    ) {
      console.log(
        "\nNothing to save."
      );

    } else {
      console.log(
        `\nFound ${newGRs.length} new GR(s).`
      );

      console.log(
        "These records have NOT been saved yet."
      );

      // ------------------------------------------------------
      // Simple readline
      // ------------------------------------------------------

      const readline =
        await import("node:readline/promises");

      const rl =
        readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

      const answer =
        await rl.question(
          `\nShould proceed to save ${newGRs.length} new GRs to PostgreSQL? (y/n): `
        );

      rl.close();

      // ------------------------------------------------------
      // SAVE
      // ------------------------------------------------------

      if (
        answer.trim().toLowerCase() === "y"
      ) {
        console.log(
          "\nSaving new GRs..."
        );

        let inserted = 0;
        let skipped = 0;

        for (
          const gr of newGRs
        ) {
          const result =
            await pool.query(
              `
              INSERT INTO historical_grs
                (code, title, gr_date)
              VALUES
                ($1, $2, $3)
              ON CONFLICT (code)
              DO NOTHING
              `,
              [
                gr.code,
                gr.title,
                gr.grDate,
              ]
            );

          if (
            result.rowCount === 1
          ) {
            inserted++;

            console.log(
              `✓ Added: ${gr.code}`
            );
          } else {
            skipped++;

            console.log(
              `→ Already existed: ${gr.code}`
            );
          }
        }

        // ----------------------------------------------------
        // SAVE SUMMARY
        // ----------------------------------------------------

        console.log(
          "\n=============================================="
        );

        console.log(
          "DATABASE UPDATE COMPLETE"
        );

        console.log(
          "=============================================="
        );

        console.log(
          `New GRs detected : ${newGRs.length}`
        );

        console.log(
          `Inserted         : ${inserted}`
        );

        console.log(
          `Skipped          : ${skipped}`
        );

        console.log(
          "=============================================="
        );

      } else {
        console.log(
          "\nSave cancelled."
        );

        console.log(
          "No records were written."
        );
      }
    }

    // ========================================================
    // FINAL
    // ========================================================

    console.log(
      "\nNo PDF files were downloaded."
    );

    console.log(
      "No CAPTCHA requested."
    );

    console.log(
      "\nBrowser will remain open."
    );

    await new Promise(() => {});

  } catch (error) {
    console.error(
      "\n❌ Updater error:"
    );

    console.error(error);

  } finally {
    await pool.end();
  }
}

main();