import React, { useEffect, useState } from "react";

const PDF_BASE =
  "https://gr.maharashtra.gov.in/Site/Upload/Government%20Resolutions/English";

const PAGE_SIZE = 50;

// Runtime-configurable API base. Set VITE_API_URL in your environment or hosting provider.
const API_BASE =
  typeof import.meta !== "undefined" &&
  import.meta.env &&
  import.meta.env.VITE_API_URL
    ? String(import.meta.env.VITE_API_URL).replace(/\/$/, "")
    : "";

function pdfUrl(code) {
  return `${PDF_BASE}/${code}.pdf`;
}

function formatDate(value) {
  if (!value) return "—";

  const iso = String(value).slice(0, 10);
  const [year, month, day] = iso.split("-");

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  if (!year || !month || !day) return "—";

  return `${day} ${months[Number(month) - 1]} ${year}`;
}

function StatusBadge({ status }) {
  const styles = {
    idle: {
      background: "#F1EFE8",
      color: "#5F5E5A",
      text: "—",
    },
    loading: {
      background: "#E6F1FB",
      color: "#185FA5",
      text: "Loading...",
    },
    done: {
      background: "#EAF3DE",
      color: "#3B6D11",
      text: "Loaded",
    },
    error: {
      background: "#FCEBEB",
      color: "#A32D2D",
      text: "Error",
    },
  };

  const s = styles[status] || styles.idle;

  return (
    <span
      style={{
        background: s.background,
        color: s.color,
        padding: "6px 9px",
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {s.text}
    </span>
  );
}

function PDFLink({ code }) {
  return (
    <a
      href={pdfUrl(code)}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "7px 11px",
        borderRadius: 5,
        fontSize: 12,
        fontWeight: 500,
        textDecoration: "none",
        color: "#1A4D8F",
        background: "#E8EFF8",
        border: "1px solid #B0C4E0",
        whiteSpace: "nowrap",
      }}
    >
      PDF Link ↗
    </a>
  );
}

function GRRow({ gr, index }) {
  return (
    <tr
      style={{
        background: index % 2 ? "#FAFAF8" : "#FFFFFF",
        verticalAlign: "top",
      }}
    >
      <td style={cellStyle("center", 50)}>
        <span
          style={{
            fontSize: 12,
            color: "#8C8A84",
            fontFamily: "monospace",
          }}
        >
          {index + 1}
        </span>
      </td>

      <td style={cellStyle("left", 185)}>
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            color: "#1A4D8F",
          }}
        >
          {gr.code}
        </span>
      </td>

      <td style={cellStyle("left", 115)}>
        <span
          style={{
            fontSize: 13,
            color: "#2C2C2A",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          {formatDate(gr.gr_date)}
        </span>
      </td>

      <td style={{ ...cellStyle("left"), minWidth: 320 }}>
        <span
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
            overflow: "hidden",
            fontSize: 13,
            lineHeight: 1.55,
            color: "#1A1916",
          }}
        >
          {gr.title}
        </span>
      </td>

      <td style={cellStyle("left", 125)}>
        <PDFLink code={gr.code} />
      </td>
    </tr>
  );
}

function cellStyle(align = "left", width) {
  return {
    padding: "15px 16px",
    borderBottom: "1px solid #E8E6DE",
    textAlign: align,
    ...(width
      ? {
          width,
          minWidth: width,
        }
      : {}),
  };
}

export default function NewPreview() {
  const [grs, setGRs] = useState([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [activeYear, setActiveYear] = useState("all");
  const [years, setYears] = useState([]);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    fetchFileList();
  }, []);

  async function fetchFileList() {
    setStatus("loading");
    setError("");

    try {
      const response = await fetch(
        `${API_BASE || "http://localhost:3001"}/api/grs`
      );

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      setGRs(data);

      const uniqueYears = [
        ...new Set(
          data
            .filter((gr) => gr.gr_date)
            .map((gr) => String(gr.gr_date).slice(0, 4))
        ),
      ].sort((a, b) => b - a);

      setYears(uniqueYears);
      setStatus("done");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  const filtered = grs.filter((gr) => {
    const iso = gr.gr_date
      ? String(gr.gr_date).slice(0, 10)
      : "";

    const year = iso ? iso.slice(0, 4) : "";

    const searchText = search.trim().toLowerCase();

    const yearMatches =
      activeYear === "all" || year === activeYear;

    const searchMatches =
      !searchText ||
      String(gr.code || "").toLowerCase().includes(searchText) ||
      String(gr.title || "").toLowerCase().includes(searchText);

    const fromMatches =
      !fromDate || (iso && iso >= fromDate);

    const toMatches =
      !toDate || (iso && iso <= toDate);

    return (
      yearMatches &&
      searchMatches &&
      fromMatches &&
      toMatches
    );
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeYear, fromDate, toDate]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;

  const displayed = filtered.slice(
    startIndex,
    startIndex + PAGE_SIZE
  );

  function clearFilters() {
    setSearch("");
    setActiveYear("all");
    setFromDate("");
    setToDate("");
  }

  function selectYear(value) {
    if (value === "all") {
      setActiveYear("all");
      setFromDate("");
      setToDate("");
      return;
    }

    setActiveYear(value);
    setFromDate(`${value}-01-01`);
    setToDate(`${value}-12-31`);
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1200,
        margin: "0 auto",
        padding: "8px 16px 30px",
        boxSizing: "border-box",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#1A1916",
      }}
    >
      <style>{`
        @keyframes new-preview-spin {
          to {
            transform: translateX(100%);
          }
        }

        .np-filter-top {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 16px;
        }

        .np-date-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 17px;
          width: 100%;
        }

        .np-date-control {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .np-date-control input {
          width: 210px;
        }

        .np-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
        }

        .np-table-wrap {
          width: 100%;
          overflow-x: auto;
          border: 1px solid #DADDDC;
          border-radius: 9px;
          background: #FFFFFF;
          box-shadow: 0 2px 8px rgba(30, 40, 45, 0.04);
        }

        @media (max-width: 850px) {
          .np-filter-top {
            grid-template-columns: 1fr;
          }

          .np-date-row {
            flex-wrap: wrap;
          }

          .np-actions {
            margin-left: 0;
          }
        }

        @media (max-width: 560px) {
          .np-date-control {
            width: 100%;
          }

          .np-date-control input {
            width: 100%;
          }

          .np-actions {
            width: 100%;
          }
        }
      `}</style>

      {/* ================= FILTER PANEL ================= */}
      <section
        style={{
          background: "#F3F5F6",
          border: "1px solid #D9DEDF",
          borderRadius: 9,
          padding: "18px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            textAlign: "center",
            fontSize: 15,
            fontWeight: 700,
            color: "#7A2722",
            paddingBottom: 12,
            borderBottom: "2px solid #D8C8B8",
            marginBottom: 18,
          }}
        >
          Government Resolutions
        </div>

        {/* Search + Year */}
        <div className="np-filter-top">
          <div>
            <label
              style={{
                display: "block",
                textAlign: "center",
                fontSize: 12,
                fontWeight: 600,
                color: "#3F4548",
                marginBottom: 7,
              }}
            >
              Search by Code or Title/Keyword
            </label>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Enter code or title/keyword"
              style={{
                width: "100%",
                height: 38,
                boxSizing: "border-box",
                padding: "8px 12px",
                border: "1px solid #C8C6BC",
                borderRadius: 5,
                background: "#FFFFFF",
                color: "#1A1916",
                fontSize: 13,
                outline: "none",
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                textAlign: "center",
                fontSize: 12,
                fontWeight: 600,
                color: "#3F4548",
                marginBottom: 7,
              }}
            >
              Year
            </label>

            <select
              value={activeYear}
              onChange={(e) => selectYear(e.target.value)}
              style={{
                width: "100%",
                height: 38,
                boxSizing: "border-box",
                padding: "7px 10px",
                border: "1px solid #C8C6BC",
                borderRadius: 5,
                background: "#FFFFFF",
                color: "#1A1916",
                fontSize: 13,
              }}
            >
              <option value="all">All years</option>

              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ================= DATE ROW ================= */}
        {/* This is deliberately one horizontal row:
            From [date]    To [date]                         Clear Refresh
        */}
        <div className="np-date-row">
          <div className="np-date-control">
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#3F4548",
                whiteSpace: "nowrap",
              }}
            >
              From
            </span>

            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{
                height: 38,
                boxSizing: "border-box",
                padding: "7px 10px",
                border: "1px solid #C8C6BC",
                borderRadius: 5,
                background: "#FFFFFF",
                color: "#1A1916",
                fontSize: 13,
              }}
            />
          </div>

          <div className="np-date-control">
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#3F4548",
                whiteSpace: "nowrap",
              }}
            >
              To
            </span>

            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{
                height: 38,
                boxSizing: "border-box",
                padding: "7px 10px",
                border: "1px solid #C8C6BC",
                borderRadius: 5,
                background: "#FFFFFF",
                color: "#1A1916",
                fontSize: 13,
              }}
            />
          </div>

          <div className="np-actions">
            <button
              type="button"
              onClick={clearFilters}
              style={{
                height: 34,
                padding: "6px 14px",
                border: "1px solid #C8C6BC",
                borderRadius: 5,
                background: "#FFFFFF",
                color: "#4B4B48",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Clear
            </button>

            <button
              type="button"
              onClick={fetchFileList}
              style={{
                height: 34,
                padding: "6px 15px",
                border: "1px solid #B7C5D6",
                borderRadius: 5,
                background: "#FFFFFF",
                color: "#1A4D8F",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 13,
          }}
        >
          <StatusBadge status={status} />

          {status === "done" && (
            <span
              style={{
                fontSize: 12,
                color: "#6F716F",
              }}
            >
              {filtered.length} GRs
            </span>
          )}
        </div>
      </section>

      {/* ================= ERROR ================= */}
      {status === "error" && (
        <div
          style={{
            padding: "16px 20px",
            marginBottom: 16,
            borderRadius: 8,
            background: "#FCEBEB",
            border: "1px solid #F7C1C1",
            color: "#A32D2D",
            fontSize: 13,
          }}
        >
          <strong>Failed to load:</strong> {error}
        </div>
      )}

      {/* ================= TABLE ================= */}
      {status !== "error" && (
        <div className="np-table-wrap">
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  background: "#F0EFE9",
                  borderBottom: "2px solid #C8C6BC",
                }}
              >
                {["#", "Unique Code", "Date", "Title", "PDF"].map(
                  (heading, index) => (
                    <th
                      key={heading}
                      style={{
                        padding: "12px 16px",
                        textAlign:
                          index === 0 ? "center" : "left",
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        color: "#5A5854",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {heading}
                    </th>
                  )
                )}
              </tr>
            </thead>

            <tbody>
              {status === "loading" &&
                Array.from({ length: 8 }).map((_, index) => (
                  <tr key={index}>
                    {Array.from({ length: 5 }).map((__, cell) => (
                      <td
                        key={cell}
                        style={{
                          padding: "15px 16px",
                          borderBottom:
                            "1px solid #E8E6DE",
                        }}
                      >
                        <div
                          style={{
                            height: 13,
                            width:
                              cell === 3 ? "80%" : "65%",
                            borderRadius: 4,
                            background: "#E8E6DE",
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}

              {status === "done" &&
                displayed.map((gr, index) => (
                  <GRRow
                    key={gr.code}
                    gr={gr}
                    index={startIndex + index}
                  />
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ================= PAGINATION ================= */}
      {status === "done" && totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 6,
            marginTop: 18,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() =>
              setCurrentPage((page) => Math.max(1, page - 1))
            }
            style={{
              padding: "7px 11px",
              borderRadius: 6,
              border: "1px solid #C8C6BC",
              background:
                currentPage === 1 ? "#F5F4F0" : "#FFFFFF",
              color:
                currentPage === 1 ? "#AAA" : "#1A4D8F",
              cursor:
                currentPage === 1 ? "default" : "pointer",
              fontSize: 12,
            }}
          >
            ← Previous
          </button>

          {Array.from(
            { length: totalPages },
            (_, index) => index + 1
          )
            .filter(
              (page) =>
                page === 1 ||
                page === totalPages ||
                Math.abs(page - currentPage) <= 2
            )
            .map((page, index, pages) => {
              const previous = pages[index - 1];

              return (
                <React.Fragment key={page}>
                  {previous && page - previous > 1 && (
                    <span
                      style={{
                        padding: "0 3px",
                        color: "#8C8A84",
                      }}
                    >
                      ...
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    style={{
                      minWidth: 32,
                      padding: "7px 8px",
                      borderRadius: 6,
                      border: "1px solid #C8C6BC",
                      background:
                        currentPage === page
                          ? "#1A4D8F"
                          : "#FFFFFF",
                      color:
                        currentPage === page
                          ? "#FFFFFF"
                          : "#1A4D8F",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight:
                        currentPage === page ? 600 : 400,
                    }}
                  >
                    {page}
                  </button>
                </React.Fragment>
              );
            })}

          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() =>
              setCurrentPage((page) =>
                Math.min(totalPages, page + 1)
              )
            }
            style={{
              padding: "7px 11px",
              borderRadius: 6,
              border: "1px solid #C8C6BC",
              background:
                currentPage === totalPages
                  ? "#F5F4F0"
                  : "#FFFFFF",
              color:
                currentPage === totalPages
                  ? "#AAA"
                  : "#1A4D8F",
              cursor:
                currentPage === totalPages
                  ? "default"
                  : "pointer",
              fontSize: 12,
            }}
          >
            Next →
          </button>
        </div>
      )}

      {status === "done" && (
        <p
          style={{
            marginTop: 12,
            fontSize: 11,
            color: "#8C8A84",
          }}
        >
          PDF links point directly to gr.maharashtra.gov.in — some may
          404 depending on availability.
        </p>
      )}
    </div>
  );
}