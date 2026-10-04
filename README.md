# watchlist-api

A minimal, readable Node.js + Express backend for a security dashboard. Users
sign up, log in, and manage a personal watchlist of CVEs. It's a
portfolio/demo project that shows a handful of secure-coding practices:

- **Password hashing** with bcrypt (cost factor 12)
- **Email verification** — signup emails a 6-digit code (Nodemailer + Gmail SMTP); login is blocked until it's confirmed
- **Parametrized SQL queries** (no string concatenation — bound `?` parameters only)
- **JWT auth** with a secret from the environment and a 7-day expiry
- **Rate limiting** on the login route (5 attempts / 15 min / IP) to blunt brute force
- **CORS** locked to a configurable frontend origin
- **Secrets from `.env`** (via dotenv), with `.env` kept out of git

It is intentionally small and not hardened for production.

## Tech stack

- [Express](https://expressjs.com/) — HTTP routing
- [@libsql/client](https://github.com/tursodatabase/libsql-client-ts) — SQLite-compatible [Turso](https://turso.tech) database
- [bcrypt](https://github.com/kelektiv/node.bcrypt.js) — password hashing
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) — JWTs
- [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) — rate limiting
- [nodemailer](https://nodemailer.com/) — sending verification emails over Gmail SMTP
- [cors](https://github.com/expressjs/cors) / [dotenv](https://github.com/motdotla/dotenv)

## Setup

Requires Node.js 18+.

```bash
# 1. Install dependencies
npm install

# 2. Create your env file and fill in values
cp .env.example .env
#    then edit .env — set a strong JWT_SECRET and your Turso connection:
#    openssl rand -hex 32   # handy for JWT_SECRET

# 3. Start the server
npm start
#    or, with auto-reload during development:
npm run dev
```

The server listens on `PORT` (default `3000`). The database tables are created
automatically on first run.

### Create a free Turso database

This app stores data in [Turso](https://turso.tech), a hosted SQLite-compatible
database with a free tier (**no credit card required**).

1. Sign up at [turso.tech](https://turso.tech).
2. Install the Turso CLI and log in:
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth login
   ```
3. Create a database and read its connection URL:
   ```bash
   turso db create watchlist
   turso db show watchlist --url      # -> TURSO_DATABASE_URL (libsql://...)
   ```
4. Mint an auth token for it:
   ```bash
   turso db tokens create watchlist   # -> TURSO_AUTH_TOKEN
   ```
5. Paste both values into your `.env` (`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`).

> You can also create the database and generate a token from the Turso web
> dashboard — the URL is shown on the database page and tokens are created
> under its **Tokens** / settings section.

**Local development without Turso:** point `TURSO_DATABASE_URL` at a local file
instead and leave `TURSO_AUTH_TOKEN` blank:

```bash
TURSO_DATABASE_URL=file:local.db
TURSO_AUTH_TOKEN=
```

## Environment variables

| Variable             | Required | Default                 | Description                                                      |
| -------------------- | -------- | ----------------------- | ---------------------------------------------------------------- |
| `JWT_SECRET`         | yes      | —                       | Secret used to sign/verify JWTs. Use a long random string.       |
| `TURSO_DATABASE_URL` | yes      | —                       | Turso/libSQL connection URL (`libsql://...`), or `file:local.db` for local dev. |
| `TURSO_AUTH_TOKEN`   | no\*     | —                       | Auth token for the Turso database. Required for `libsql://` URLs; leave blank for `file:` URLs. |
| `GMAIL_USER`         | yes      | —                       | Gmail address that sends verification emails.                    |
| `GMAIL_APP_PASSWORD` | yes      | —                       | 16-character Gmail **App Password** (not your normal password).  |
| `PORT`               | no       | `3000`                  | Port the HTTP server listens on.                                 |
| `FRONTEND_ORIGIN`    | no       | `http://localhost:5173` | Origin allowed to make CORS requests.                            |

\* Required in practice for a hosted Turso database.

The server refuses to start if `JWT_SECRET`, `TURSO_DATABASE_URL`, `GMAIL_USER`,
or `GMAIL_APP_PASSWORD` is not set.

### Generate a Gmail App Password (free)

Verification emails are sent through Gmail's SMTP using an **App Password** — a
16-character token scoped to this app, separate from your real password. It
requires 2-Step Verification on the Google account.

1. Enable 2-Step Verification: <https://myaccount.google.com/security>
2. Open <https://myaccount.google.com/apppasswords>
3. Create an app password (name it e.g. `watchlist-api`) and copy the
   16-character value.
4. In `.env`, set `GMAIL_USER` to your Gmail address and `GMAIL_APP_PASSWORD`
   to that value (spaces removed).

> Gmail's free tier allows roughly 500 messages/day — ample for a demo.

## Data model

**users**

| column                 | type    | notes                                         |
| ---------------------- | ------- | --------------------------------------------- |
| `id`                   | INTEGER | primary key                                   |
| `email`                | TEXT    | unique                                        |
| `password_hash`        | TEXT    | bcrypt hash                                   |
| `verified`             | INTEGER | `0` until the emailed code is confirmed, then `1` |
| `verification_code`    | TEXT    | current 6-digit code; cleared once verified   |
| `verification_expires` | TEXT    | ISO timestamp; code valid for 15 minutes      |
| `created_at`           | TEXT    | set automatically                             |

**watchlist**

| column     | type    | notes                                        |
| ---------- | ------- | -------------------------------------------- |
| `id`       | INTEGER | primary key                                  |
| `user_id`  | INTEGER | foreign key → `users.id` (cascade on delete) |
| `cve`      | TEXT    | e.g. `CVE-2024-3094`                         |
| `vendor`   | TEXT    | optional                                     |
| `note`     | TEXT    | optional                                     |
| `added_at` | TEXT    | set automatically                            |

## Authentication

Protected routes require an `Authorization: Bearer <token>` header. Tokens are
obtained from `/auth/verify` (after confirming the emailed code) or
`/auth/login` and are valid for 7 days.

**Flow:** `POST /auth/signup` → check email for a 6-digit code →
`POST /auth/verify` (returns a token and activates the account) → thereafter
`POST /auth/login`. Login is rejected until the account is verified.

## Endpoints

### `GET /health`

Liveness check.

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### `POST /auth/signup`

Create an **unverified** account and email a 6-digit verification code. Email
must be valid; password must be at least 8 characters. **No token is returned
yet** — the account must be verified first.

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@example.com","password":"correct horse battery"}'
# {"message":"Account created. Check your email for a 6-digit verification code, then POST it to /auth/verify to activate your account.","email":"analyst@example.com"}
```

Responses: `201` with `{ message, email }` · `400` invalid input · `409` email already registered · `502` verification email could not be sent (the pending account is rolled back so you can retry).

### `POST /auth/verify`

Submit the 6-digit code emailed at signup. On success the account is activated
and a JWT is returned (so you don't need to log in again). The code expires 15
minutes after signup. **Rate limited to 10 attempts per 15 minutes per IP** so
the code can't be brute-forced.

```bash
curl -X POST http://localhost:3000/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@example.com","code":"042195"}'
# {"token":"eyJhbGciOi..."}
```

Responses: `200` with `{ token }` (or `{ message }` if already verified) · `400` invalid/expired code or bad input · `429` too many attempts.

### `POST /auth/login`

Verify credentials and return a JWT. **Login is blocked until the account's
email is verified.** **Rate limited to 5 attempts per 15 minutes per IP.**

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@example.com","password":"correct horse battery"}'
# {"token":"eyJhbGciOi..."}
```

Responses: `200` with `{ token }` · `400` invalid input · `401` wrong credentials · `403` email not verified · `429` too many attempts.

### `GET /watchlist` _(protected)_

Return the logged-in user's saved CVEs, newest first.

```bash
TOKEN='paste-your-jwt-here'

curl http://localhost:3000/watchlist \
  -H "Authorization: Bearer $TOKEN"
# {"items":[{"id":1,"cve":"CVE-2024-3094","vendor":"xz","note":"backdoor","added_at":"..."}]}
```

### `POST /watchlist` _(protected)_

Add a CVE to the logged-in user's watchlist. Only `cve` is required.

```bash
curl -X POST http://localhost:3000/watchlist \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"cve":"CVE-2024-3094","vendor":"xz","note":"supply-chain backdoor"}'
# {"item":{"id":1,"cve":"CVE-2024-3094","vendor":"xz","note":"supply-chain backdoor","added_at":"..."}}
```

Responses: `201` with `{ item }` · `400` missing `cve` · `401` missing/invalid token.

### `DELETE /watchlist/:id` _(protected)_

Delete one of the logged-in user's watchlist entries. Entries that belong to
another user (or don't exist) return `404`.

```bash
curl -X DELETE http://localhost:3000/watchlist/1 \
  -H "Authorization: Bearer $TOKEN"
# 204 No Content
```

Responses: `204` deleted · `400` invalid id · `401` missing/invalid token · `404` not found.

## Security notes

- Passwords are never stored or logged in plaintext — only bcrypt hashes.
- Login uses a constant-shape bcrypt comparison and a single generic error
  message so responses don't reveal whether an email is registered.
- All SQL runs through parametrized statements with bound parameters, so user
  input is never concatenated into query text.
- Watchlist reads, writes, and deletes are always scoped to the authenticated
  `user_id`, so one user cannot see or remove another user's entries.
- Email verification codes are generated with a CSPRNG (`crypto.randomInt`),
  expire after 15 minutes, are compared in constant time, and are cleared from
  the database once used. `/auth/verify` is rate-limited and returns one
  generic error for every failure so it can't be used to enumerate accounts.
- `.env` is gitignored; only `.env.example` (placeholders) is committed.

## Project structure

```
src/
  index.js                 # app setup: env, CORS, JSON, routes, error handling
  db.js                    # Turso/libSQL client + schema init
  auth.js                  # JWT signing + requireAuth middleware
  mailer.js                # Nodemailer (Gmail SMTP) verification emails
  routes/
    authRoutes.js          # POST /auth/signup, /auth/verify, /auth/login (rate-limited)
    watchlistRoutes.js     # GET/POST /watchlist, DELETE /watchlist/:id
```

## License

MIT
