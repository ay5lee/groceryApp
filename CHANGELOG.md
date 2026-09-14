# Changelog

## 2026-09-14
### Added
- WhatsApp notification via WA-Gateway when a transaction is added (includes receipt image if present)
- Current balance shown in WhatsApp notification message
- Daily database backup sidecar container (keeps 7 most recent `.sql` files)
- `RECEIPTS_PATH`, `DB_DATA_PATH`, `BACKUP_PATH` env vars for configurable host mount paths
- `.env.example` documenting all environment variables

### Changed
- Postgres data now uses a host bind-mount (`DB_DATA_PATH`) instead of a named Docker volume, so data survives Portainer stack redeployments
- All secrets (`DB_PASSWORD`, `JWT_SECRET`) moved to `${VAR}` placeholders in `docker-compose.yml` — no credentials stored in git
- Removed `version: '3.8'` from docker-compose.yml (obsolete in Docker Compose v2)

### Security
- Receipt images now served via authenticated API endpoint (`/api/receipts/:filename`) instead of publicly accessible static files

---

## 2026-07 — Portainer & NAS Migration
### Added
- NAS mount for receipt uploads via `RECEIPTS_PATH` environment variable
- Portainer-compatible docker-compose.yml (removed dev bind-mounts)

### Changed
- Mobile transaction cards made more compact
- Full UI revamp with mobile-first design and responsive CSS rewrite

---

## 2026-06 — Reports & Stability
### Added
- Monthly spending breakdown in the Reports section

### Changed
- `init.sql` made safe for re-runs: replaced `DROP TABLE` with `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING`
- Reset default admin password to `admin` in `init.sql`
- CSS rewritten from scratch for clean mobile responsiveness

---

## 2026-05 — Initial Release
### Added
- Initial GroceryMate app: transaction tracking, JWT authentication, receipt photo upload
- Admin and helper roles
- Reports, user management, and transaction type configuration
