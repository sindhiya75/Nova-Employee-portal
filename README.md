# NOVA+ Employee Portal

NOVA+ Employee Portal is a React Native mobile application for construction employees. It provides attendance tracking, employee-specific active work, daily progress reporting, machinery usage, emergency contacts, notifications, and task history.

The mobile app uses Expo and connects to the included Node.js/Express and PostgreSQL backend.

## Features

- Employee login with isolated employee sessions
- Securely stored signed session tokens
- Daily Check In and Check Out attendance
- Leave requests and late attendance marking
- Employee-specific Active Work list
- Task details and completion tracking
- Daily work logs with GPS coordinates
- Searchable machinery selection and quantity tracking
- Work-log history and PDF export
- Emergency contact panel
- Employee-scoped notifications

## Technology

- React Native 0.81
- Expo SDK 54
- TypeScript
- Node.js and Express
- PostgreSQL
- Expo SecureStore, Location, Print, and Sharing

## Project structure

```text
pmma1/
├── App.tsx                 Main Expo application
├── services/
│   └── api.ts              Shared backend API and session client
├── backend/
│   ├── src/
│   │   ├── routes/         Express API routes
│   │   ├── utils/          Access, audit, upload, and token helpers
│   │   └── server.js       Backend entry point
│   ├── .env.example
│   └── package.json
├── database/
│   ├── schema.sql          Base PostgreSQL schema
│   ├── seed.sql            Base development data
│   └── migrate_*.sql       Incremental database migrations
├── app.json                Expo configuration
├── .env.example            Mobile API URL example
└── package.json            Mobile scripts and dependencies
```

## Prerequisites

Install the following before starting:

- Node.js 20 or newer
- npm
- PostgreSQL 17 or a compatible recent PostgreSQL version
- Expo Go on a physical Android/iOS device, or Android Studio with an emulator

## 1. Install dependencies

Install the mobile dependencies from the repository root:

```powershell
npm install
```

Install backend dependencies:

```powershell
cd backend
npm install
cd ..
```

## 2. Configure PostgreSQL

Create a PostgreSQL database named `construction_monitoring`.

Start with the base files:

1. Run `database/schema.sql`.
2. Run `database/seed.sql`.
3. Apply the migration files in the order required by `database/README.md` and then apply the remaining `migrate_*.sql` files.

The repository includes idempotent migrations for attendance, task management, notifications, machinery usage, employee identity isolation, and the employee portal reference tasks. Migrations using `IF NOT EXISTS` can safely be reapplied.

Do not run `schema.sql` against a database containing data you need to retain because the base schema script recreates tables. Use only incremental migrations for an existing database.

## 3. Configure the backend

Copy the example environment file:

```powershell
Copy-Item backend/.env.example backend/.env
```

Edit `backend/.env`:

```dotenv
PORT=5001
PGHOST=localhost
PGPORT=5432
PGDATABASE=construction_monitoring
PGUSER=postgres
PGPASSWORD=your_postgres_password
UPLOAD_ROOT=../uploads
FRONTEND_ORIGIN=http://localhost:8081
SESSION_SECRET=replace_with_a_long_random_secret
```

Never commit `backend/.env` or a real database password.

Start the backend:

```powershell
cd backend
npm start
```

Verify it is available:

```text
http://localhost:5001/api/health
```

The response should include `"status": "ok"`.

## 4. Configure the mobile API URL

Copy the root example file:

```powershell
Copy-Item .env.example .env
```

Choose the correct URL for the device running Expo.

Android emulator:

```dotenv
EXPO_PUBLIC_API_URL=http://10.0.2.2:5001/api
```

Physical phone on the same Wi-Fi network:

```dotenv
EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_LAN_IP:5001/api
```

To find the computer's IPv4 address on Windows:

```powershell
ipconfig
```

Do not use `localhost` for a physical phone. On the phone, `localhost` refers to the phone itself.

## 5. Run the mobile app

From the repository root:

```powershell
npm start -- --clear
```

Then:

- Scan the QR code using Expo Go, or
- Press `a` to open the Android emulator.

Keep the backend terminal running while using the application.

## Prototype employee login

For prototype testing, an employee enters their own name and uses:

```text
Password: 1234
```

On first login, the backend creates a unique employee account and signed session token for that name. The employee receives separate copies of the reference Active Work tasks. Progress, attendance, logs, completion state, and notifications remain isolated by employee ID.

Reusing the same employee name returns the same employee account. Names are case-insensitive during login.

This automatic employee creation is intended for prototype/testing use. Before production, replace it with administrator-managed accounts and hashed passwords.

## Useful commands

Mobile type check:

```powershell
npm run typecheck
```

Export and verify an Android JavaScript bundle:

```powershell
npx expo export --platform android
```

Run the backend in development mode:

```powershell
cd backend
npm run dev
```

## Attendance behavior

- A user with no attendance record for the current local date sees Check In.
- Check In creates or updates today's record with `Present` status.
- The card immediately changes to Check Out and displays assigned/active tasks.
- Check Out records the end time and displays the completed shift.
- Attendance queries are scoped to the employee ID in the signed token and the current calendar date.

## Troubleshooting

### The app cannot connect to the backend

- Confirm the backend is running on port `5001`.
- Confirm `/api/health` works on the development computer.
- For a physical phone, use the computer's LAN IP in `.env`.
- Confirm the phone and computer are on the same network.
- Allow Node.js through the Windows firewall if prompted.
- Restart Expo with `npm start -- --clear` after changing `.env`.

### Database relation or column does not exist

The database migrations have not all been applied. Apply the incremental scripts in `database/` to the `construction_monitoring` database. Do not rerun the destructive base schema on a database containing important data.

### An old login is restored

Open the navigation drawer and log out. The app stores valid sessions with Expo SecureStore and automatically discards legacy employee sessions that do not contain a signed token.

### Location does not fill GPS fields

Allow location permission when requested. A simulator must have a mock GPS location configured.

## Security notes

- Never commit `.env` files, database passwords, production session secrets, or generated signing credentials.
- The included `1234` prototype login must not be used in production.
- Production passwords should be hashed with a password-hashing algorithm such as Argon2 or bcrypt.
- Use HTTPS for production API traffic.
- Restrict CORS and rotate `SESSION_SECRET` for deployed environments.

## Building an Android APK

Install and configure EAS CLI, authenticate with an Expo account, and create an `eas.json` preview profile with Android `buildType` set to `apk`. Then run:

```powershell
eas build -p android --profile preview
```

## License

Add the license appropriate for your organization before publishing the repository publicly.
