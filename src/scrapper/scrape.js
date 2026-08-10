import { chromium } from "playwright";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import pg from "pg";

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

const PAGE_URL =
  "https://gr.maharashtra.gov.in/1145/Government-Resolutions";

const PDF_BASE =
  "https://gr.maharashtra.gov.in/Site/Upload/Government%20Resolutions/English";

const SELECTORS = {
  language: "#HeaderMain1_SetCulture1_btn_Language",
  department: "#SitePH_ddlDepartmentType",
  fromDate: "#SitePH_txtFromDate",
  toDate: "#SitePH_txtToDate",
  captcha: "#SitePH_txtimgcode",
  search: "#SitePH_btnSearch",
  table: "#SitePH_dgvDocuments",
  pageInfo: "#SitePH_ucPaging_pnlPageNo",
  nextPage: "#SitePH_ucPaging_lnkNext",
};

function expectedPdf(code) {
  return `${PDF_BASE}/${code}.pdf`;
}

async function ask(rl, question) {
  return (await rl.question(question)).trim();
}

async function setDate(page, selector, value) {
  await page.locator(selector).evaluate((el, value) => {
    el.value = value;
  }, value);
}

async function getPageInfo(page) {
  const text = await page
    .locator(SELECTORS.pageInfo)
    .innerText();

  // Example:
  // "Page No. :    / 2"
  const match = text.match(/\/\s*(\d+)/);

  if (!match) {
    throw new Error(
      `Could not determine total pages from: "${text}"`
    );
  }

  return Number(match[1]);
}

async function scrapeCurrentPage(
  page,
  results,
  urlMismatches
) {
  const rows = page.locator(`${SELECTORS.table} tr`);
  const rowCount = await rows.count();

  let pageRecords = 0;

  // Row 0 is the table header.
  for (let i = 1; i < rowCount; i++) {
    const row = rows.nth(i);
    const cells = row.locator("td");

    if ((await cells.count()) === 0) {
      continue;
    }

    const title = (
      await cells.nth(2).innerText()
    ).trim();

    const code = (
      await cells.nth(3).innerText()
    ).trim();

    const grDate = (await cells.nth(4).innerText()).trim();

    const href = await row
      .locator("a")
      .getAttribute("href");

    if (!href) {
      console.log(
        `⚠ No PDF link found for ${code}`
      );
      continue;
    }

    const pdfUrl = new URL(
      href,
      PAGE_URL
    ).href;

    const expected = expectedPdf(code);

    const urlMatches =
      pdfUrl === expected;

    if (!urlMatches) {
      urlMismatches.push(code);
    }

    results.push({
      title,
      code,
      grDate,
      pdfUrl,
      urlMatches,
    });

    pageRecords++;

  }

  return pageRecords;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS historical_grs (
      code TEXT PRIMARY KEY,
      title TEXT NOT NULL
    );
  `);
}

async function saveResults(results) {
  let inserted = 0;
  let duplicates = 0;
  const duplicateCodes = [];

  for (const record of results) {
    // Convert portal format DD-MM-YYYY
    // to PostgreSQL format YYYY-MM-DD
    const [day, month, year] = record.grDate.split("-");

    const grDate = `${year}-${month}-${day}`;

    const result = await pool.query(
      `
      INSERT INTO historical_grs (code, title, gr_date)
      VALUES ($1, $2, $3)
      ON CONFLICT (code) DO NOTHING;
      `,
      [record.code, record.title, grDate]
    );

    if (result.rowCount === 1) {
      inserted++;
    } else {
      duplicates++;
      duplicateCodes.push(record.code);
    }
  }

  return {
    inserted,
    duplicates,
    duplicateCodes,
  };
}

async function main() {
  const rl = readline.createInterface({
    input,
    output,
  });

  let browser;

  try {
    // ============================================
    // START BROWSER
    // ============================================

    browser = await chromium.launch({
      headless: false,
      slowMo: 100,
    });

    const page = await browser.newPage();

    console.log(
      "Opening Government Resolution portal...\n"
    );

    await page.goto(PAGE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // ============================================
    // SWITCH TO ENGLISH
    // ============================================

    console.log("Switching to English...");

    await page.click(
      SELECTORS.language
    );

    await page
      .waitForLoadState("networkidle")
      .catch(() => {});

    await page
      .locator(SELECTORS.department)
      .waitFor({
        state: "visible",
        timeout: 30000,
      });

    console.log(
      "✓ English selected\n"
    );

    // ============================================
    // DEPARTMENT
    // ============================================

    console.log(
      "Selecting department..."
    );

    await page.selectOption(
      SELECTORS.department,
      {
        value: "08",
      }
    );

    console.log(
      "✓ Department selected.\n"
    );

    // ============================================
    // DATES
    // ============================================

    const fromDate = await ask(
      rl,
      "From Date (Example: 1 Jan, 1989): "
    );

    const toDate = await ask(
      rl,
      "To Date   (Example: 31 Dec, 1989): "
    );

    await setDate(
      page,
      SELECTORS.fromDate,
      fromDate
    );

    await setDate(
      page,
      SELECTORS.toDate,
      toDate
    );

    console.log(
      "\n✓ Dates entered."
    );

    // ============================================
    // CAPTCHA
    // ============================================

    const captcha = await ask(
      rl,
      "Enter CAPTCHA: "
    );

    await page.fill(
      SELECTORS.captcha,
      captcha
    );

    console.log(
      "\nSearching...\n"
    );

    // ============================================
    // SEARCH
    // ============================================

    await Promise.all([
      page.click(SELECTORS.search),
      page
        .waitForLoadState("networkidle")
        .catch(() => {}),
    ]);

    await page.waitForTimeout(1500);

    // ============================================
    // CHECK RESULTS
    // ============================================

    await page
      .locator(SELECTORS.table)
      .waitFor({
        state: "visible",
        timeout: 30000,
      });

    // ============================================
    // PAGE INFORMATION
    // ============================================

    const totalPages =
      await getPageInfo(page);

    const firstPageRows =
      page.locator(
        `${SELECTORS.table} tr`
      );

    const firstPageRowCount =
      await firstPageRows.count();

    const firstPageRecords =
      Math.max(
        0,
        firstPageRowCount - 1
      );

    console.log(
      `Total Pages   : ${totalPages}`
    );

    console.log(
      "Current Page  : 1"
    );

    console.log(
      `Found ${firstPageRecords} record(s) on page 1.\n`
    );

    // ============================================
    // SCRAPE ALL PAGES
    // ============================================

    const results = [];
    const urlMismatches = [];

    for (
      let currentPage = 1;
      currentPage <= totalPages;
      currentPage++
    ) {
      console.log(
        "=============================================="
      );

      console.log(
        `Scraping page ${currentPage}/${totalPages}...`
      );

      console.log(
        "=============================================="
      );

      const beforeFirstCode =
        currentPage > 1
          ? await page
              .locator(
                `${SELECTORS.table} tr`
              )
              .nth(1)
              .locator("td")
              .nth(3)
              .innerText()
          : null;

      const recordsOnPage =
        await scrapeCurrentPage(
          page,
          results,
          urlMismatches
        );

      console.log(
        `\n✓ Page ${currentPage}: ${recordsOnPage} record(s)\n`
      );

      // Last page
      if (
        currentPage === totalPages
      ) {
        break;
      }

      // ==========================================
      // NEXT PAGE
      // ==========================================

      console.log(
        `Moving to page ${currentPage + 1}...`
      );

      await page.click(
        SELECTORS.nextPage
      );

      if (beforeFirstCode !== null) {
        await page.waitForFunction(
          ({
            tableSelector,
            previousCode,
          }) => {
            const row =
              document.querySelector(
                `${tableSelector} tr:nth-child(2)`
              );

            if (!row) {
              return false;
            }

            const cells =
              row.querySelectorAll(
                "td"
              );

            if (cells.length < 4) {
              return false;
            }

            return (
              cells[3].innerText.trim() !==
              previousCode
            );
          },
          {
            tableSelector:
              SELECTORS.table,
            previousCode:
              beforeFirstCode,
          }
        );
      } else {
        await page.waitForTimeout(
          1000
        );
      }

      await page.waitForTimeout(500);

      console.log(
        `✓ Page ${currentPage + 1} loaded.\n`
      );
    }

    // ============================================
    // URL SUMMARY
    // ============================================

    const matchingUrls =
      results.filter(
        record =>
          record.urlMatches
      ).length;

    const mismatchingUrls =
      urlMismatches.length;

    console.log(
      "\nURL Mismatches"
    );

    console.log(
      "----------------------------------------------"
    );

    if (
      urlMismatches.length === 0
    ) {
      console.log(
        "None ✓"
      );
    } else {
      for (
        const code of urlMismatches
      ) {
        console.log(code);
      }
    }

    // ============================================
    // SCRAPING SUMMARY
    // ============================================

    console.log("\n");

    console.log(
      "=============================================="
    );

    console.log(
      "SCRAPING COMPLETE"
    );

    console.log(
      "=============================================="
    );

    console.log(
      `Total pages     : ${totalPages}`
    );

    console.log(
      `Total scraped   : ${results.length}`
    );

    console.log(
      `URL matches     : ${matchingUrls}`
    );

    console.log(
      `URL mismatches  : ${mismatchingUrls}`
    );

    console.log(
      "=============================================="
    );

    if (
      mismatchingUrls > 0
    ) {
      console.log(
        "\n⚠ Some PDF URLs do not match the expected pattern."
      );
    } else {
      console.log(
        "\n✓ All scraped PDF URLs match the expected pattern."
      );
    }

    // ============================================
    // SAVE CONFIRMATION
    // ============================================

    const saveAnswer =
      await ask(
        rl,
        `\nShould proceed to save ${results.length} records to PostgreSQL? (y/n): `
      );

    if (
      saveAnswer.toLowerCase() === "y"
    ) {
      console.log(
        "\nPreparing PostgreSQL..."
      );

      await ensureTable();

      const {
        inserted,
        duplicates,
        duplicateCodes,
      } = await saveResults(
        results
      );

      console.log(
        "\n=============================================="
      );
      console.log(
        "DATABASE SAVE COMPLETE"
      );

      console.log(
        "=============================================="
      );

      console.log(
        `Scraped records : ${results.length}`
      );

      console.log(
        `New records     : ${inserted}`
      );

      console.log(
        `Already existed : ${duplicates}`
      );

      if (duplicateCodes.length === 0) {
        console.log("Duplicates      : None ✓");
      } else {
        console.log("\nDuplicate Codes");
        console.log("----------------------------------------------");

          for (const code of duplicateCodes) {
            console.log(code);
          }
        }
      

      console.log(
        "=============================================="
      );
    } else {
      console.log(
        "\nSave cancelled."
      );

      console.log(
        "No records were written to PostgreSQL."
      );
    }

    console.log(
      "\nBrowser will close."
    );

  } catch (error) {
    console.error(
      "\n❌ Scraper error:"
    );
    console.error(error);
  } finally {
    rl.close();

    if (browser) {
      await browser.close();
    }

    await pool.end();
  }
}
main();