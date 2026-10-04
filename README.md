# India Exploit Window

> **How fast does India's national CERT warn about vulnerabilities already confirmed under active attack?**

A security research tool that measures the lag between CISA's Known Exploited Vulnerabilities (KEV) catalog and CERT-In's vulnerability advisories — vendor by vendor, year by year.

🔴 **Live dashboard →** [vulnwatch-olive.vercel.app](https://vulnwatch-olive.vercel.app)

---

## The Finding (2026 run)

| Metric | Result |
|--------|--------|
| CERT-In notes collected | 487 |
| Unique CVEs referenced | 3,536 |
| CVEs also in CISA KEV | **123** |
| Median warning lag | **+1 day** |
| Warned *before* CISA | 28% |
| Warned 7+ days *after* CISA | 19% |

**Vendors with longest median lag (min 3 CVEs):**

| Vendor | CVEs | Median lag |
|--------|------|-----------|
| Apple | 5 | +14 days |
| Synacor | 3 | +11 days |
| Check Point | 4 | +4 days |
| SonicWall | 4 | +4 days |
| Ivanti | 5 | +3 days |
| Google | 7 | +3 days |
| Microsoft | 7 | +1 day |
| Cisco | 13 | +1 day |

**Takeaway:** CERT-In is fast *on average* — it sometimes beats CISA. The tail risk is in Apple and niche vendors where warnings arrive up to two weeks late.

---

## What It Measures

```
lag_days = CERT-In advisory date − CISA KEV dateAdded
```

- **Negative** → CERT-In warned India *before* CISA confirmed active exploitation
- **Zero / small positive** → roughly in sync
- **Large positive** → the window during which Indian networks had no official warning

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  india_exploit_     │────▶│  data/joined.csv  │────▶│  Vercel         │
│  window.py          │     │  (local output)   │     │  Dashboard      │
│  (data pipeline)    │     └──────────────────┘     │  (static HTML)  │
└─────────────────────┘                               └─────────────────┘
         │                                                     │
         ▼                                                     ▼
┌─────────────────────┐                           ┌─────────────────────┐
│  CERT-In notes      │                           │  Render             │
│  cert-in.org.in     │                           │  Watchlist API      │
└─────────────────────┘                           │  (Node.js/Express)  │
┌─────────────────────┐                           └─────────────────────┘
│  CISA KEV catalog   │                                     │
│  cisa.gov           │                           ┌─────────────────────┐
└─────────────────────┘                           │  Turso DB           │
                                                  │  (SQLite, Mumbai)   │
                                                  └─────────────────────┘
```

**Stack:**
- **Pipeline:** Python 3 · `requests` · `beautifulsoup4`
- **Dashboard:** Vanilla JS · [Motion.one](https://motion.dev) · dark-first CSS (no framework)
- **API backend:** Node.js · Express · JWT auth · libSQL (Turso)
- **Hosting:** Vercel (dashboard) · Render (API) · Turso Mumbai (DB)

---

## Run It Yourself

### 1. Collect data

```bash
pip install requests beautifulsoup4
python india_exploit_window.py --years 2026
```

Outputs to `data/`:
- `certin_notes.csv` — every CERT-In note with its CVEs and publish date
- `kev.csv` — CISA KEV catalog snapshot
- `joined.csv` — CVEs present in both, with `lag_days`

Requests are cached in `data/cache/` — reruns don't hit CERT-In again.

### 2. View in the dashboard

Open [vulnwatch-olive.vercel.app](https://vulnwatch-olive.vercel.app) and click **↑ Load joined.csv** to recompute everything from your own run. All analysis runs locally in your browser — nothing is uploaded.

### 3. Run the API locally (optional)

```bash
cd src
npm install
cp .env.example .env   # add TURSO_URL, TURSO_AUTH_TOKEN, JWT_SECRET
node index.js
```

---

## Project Structure

```
Vulnwatch/
├── india_exploit_window.py   # data pipeline
├── index.html                # dashboard (deployed to Vercel)
├── src/
│   └── index.js              # Express API (deployed to Render)
├── data/                     # pipeline outputs (gitignored)
│   ├── certin_notes.csv
│   ├── kev.csv
│   └── joined.csv
└── README.md
```

---

## Methodology & Honest Caveats

- CERT-In's first mention of each CVE is used (they sometimes revisit a CVE in a later note).
- The matched set is small relative to total KEV size — 123 of ~1,200+ KEV entries appeared in 2026 CERT-In notes. Many KEV entries pre-date 2026 or cover products CERT-In doesn't track.
- Per-vendor medians rest on 3–13 CVEs each — directional, not statistically strong. Running 2023–2024 widens the base.
- "Before CISA" doesn't necessarily mean CERT-In was faster — CERT-In may have covered the CVE in a batch note covering older issues.

---

## Why This Matters for a SOC Analyst

During the lag window, analysts relying solely on CERT-In advisories have no official signal that a CVE is under active exploitation. This project quantifies that blind spot — and shows which vendors' patches deserve proactive monitoring beyond official channels.

---

## Data Sources

- [CERT-In Vulnerability Notes](https://www.cert-in.org.in/s2cMainServlet?pageid=VLNLIST)
- [CISA Known Exploited Vulnerabilities Catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)

---

*Built as a student security research project for placement portfolio · 2026*
