# watchlist-api

A minimal, readable Node.js + Express backend for a security dashboard. Users
sign up, log in, and manage a personal watchlist of CVEs. It's a
portfolio/demo project that shows a handful of secure-coding practices:

- **Password hashing** with bcrypt (cost factor 12)
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
| `PORT`               | no       | `3000`                  | Port the HTTP server listens on.                                 |
| `FRONTEND_ORIGIN`    | no       | `http://localhost:5173` | Origin allowed to make CORS requests.                            |

\* Required in practice for a hosted Turso database.

The server refuses to start if `JWT_SECRET` or `TURSO_DATABASE_URL` is not set.

## Data model

**users**

| column          | type    | notes                     |
| --------------- | ------- | ------------------------- |
| `id`            | INTEGER | primary key               |
| `email`         | TEXT    | unique                    |
| `password_hash` | TEXT    | bcrypt hash               |
| `created_at`    | TEXT    | set automatically         |

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
obtained from `/auth/signup` or `/auth/login` and are valid for 7 days.

## Endpoints

### `GET /health`

Liveness check.

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### `POST /auth/signup`

Create an account. Returns a JWT. Email must be valid; password must be at
least 8 characters.

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@example.com","password":"correct horse battery"}'
# {"token":"eyJhbGciOi..."}
```

Responses: `201` with `{ token }` · `400` invalid input · `409` email already registered.

### `POST /auth/login`

Verify credentials and return a JWT. **Rate limited to 5 attempts per 15
minutes per IP.**

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@example.com","password":"correct horse battery"}'
# {"token":"eyJhbGciOi..."}
```

Responses: `200` with `{ token }` · `400` invalid input · `401` wrong credentials · `429` too many attempts.

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
- `.env` is gitignored; only `.env.example` (placeholders) is committed.

## Project structure

```
src/
  index.js                 # app setup: env, CORS, JSON, routes, error handling
  db.js                    # Turso/libSQL client + schema init
  auth.js                  # JWT signing + requireAuth middleware
  routes/
    authRoutes.js          # POST /auth/signup, POST /auth/login (rate-limited)
    watchlistRoutes.js     # GET/POST /watchlist, DELETE /watchlist/:id
```

## License

MIT
