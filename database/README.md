# PostgreSQL 17 Local Setup

The app is configured for PostgreSQL 17.

## Option A: pgAdmin

1. Open pgAdmin.
2. Connect to your PostgreSQL 17 server.
3. Create a database named `construction_monitoring`, or open the Query Tool on the default `postgres` database and run `create_database_postgres.sql`.
4. Connect to the `construction_monitoring` database.
5. Run `schema.sql`.
6. Run `seed.sql`.
7. Run `migrate_attendance_dashboard.sql`.
8. Run `migrate_roles_work_audit.sql`.

## Option B: psql

```powershell
psql -U postgres -d postgres -f create_database_postgres.sql
psql -U postgres -d construction_monitoring -f schema.sql
psql -U postgres -d construction_monitoring -f seed.sql
psql -U postgres -d construction_monitoring -f migrate_attendance_dashboard.sql
psql -U postgres -d construction_monitoring -f migrate_roles_work_audit.sql
```

Then copy `backend/.env.example` to `backend/.env` and set your PostgreSQL password.

## Demo Login

- Admin: `admin@nova.local` / `admin123`
- Manager: `manager@nova.local` / `manager123`
- Employee: `employee@nova.local` / `employee123`
- Client Viewer: `client@nova.local` / `client123`

The application stores uploaded image/PDF/Excel/drawing files on disk under `uploads/` and stores only file paths in PostgreSQL.
