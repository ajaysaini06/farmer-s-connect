# Farmer's Connect

A full-stack MVP scaffold for the Farmer's Connect PRD. The browser app is served by a Node.js backend and uses SQLite for accounts, listings, inquiries, purchase requests, and order records.

## Run locally

Requires Node.js 25.7 or newer. The app uses Node's built-in `node:sqlite` module and has no package dependencies.

```powershell
node server.mjs
```

Open <http://localhost:3000>. You can also use `npm.cmd start` on Windows. The SQLite database is created at `data/farmers-connect.sqlite` and is ignored by Git.

## Set up on another computer (Windows)

1. Copy or extract the complete project folder onto the other computer. To keep accounts and app data, stop the server first and copy both `data/farmers-connect.sqlite` and `data/identity.key` into the same `data` folder in the copied project. The database and key are ignored by Git, so a Git clone will not include them.
2. Install Node.js 25.7.0 or newer from the [official Node.js downloads page](https://nodejs.org/en/download). The installer includes npm.
3. Open PowerShell in the project folder and confirm Node.js and npm are available:

   ```powershell
   node --version
   npm --version
   ```

4. Start the app:

   ```powershell
   npm.cmd start
   ```

5. Open <http://localhost:3000> in a browser.

No `npm install` or separate SQLite installation is needed: this app has no third-party npm packages and uses Node.js's built-in `node:sqlite` module. See [REQUIREMENTS.txt](REQUIREMENTS.txt) for the runtime requirements. If you do not copy the database, the app creates a fresh, empty database on first start.

## Official market prices

The **Market prices** page reads the latest daily wholesale reports from AGMARKNET through the Government of India's data.gov.in API. To enable it, create a personal API key on [data.gov.in](https://www.data.gov.in/), then create a `.env` file in the project folder from `.env.example`:

```powershell
Copy-Item .env.example .env
notepad .env
```

Add the key after the equals sign and restart the app:

```text
DATA_GOV_API_KEY=your_personal_key_here
```

The key stays on the server and is never sent to the browser. The page loads the selected state's official records when **Search** is pressed, then lets users filter by district, commodity group, crop, variety, grade, market, and date. Without a key, the region, crop-group, crop, and date filters remain available and the page explains how to enable official prices. The table intentionally excludes arrival data.

## Account access

Choose **Create account** the first time. Select a role, enter your name, phone number, and password, then verify the phone with the local development OTP `123456`. OTP verification happens once during account creation.

Choose **Log in** for an existing account. Enter its phone number and password; login does not request an OTP. The account opens with its saved role, which cannot be changed after registration.

New account records and user-created listings, messages, orders, and requirements persist in SQLite. Accounts created before password login was added can use **Set a password for an older account** once to verify the phone and establish a password.

Signup collects role-specific details: farmer registry/KCC/land-record/PM-KISAN information, consumer occupation, or industry owner/email/GSTIN/Udyam information. Government ID references and uploaded documents are encrypted in the database. Phone OTP confirms the mobile number; this prototype does not verify documents against government records. Local development creates `data/identity.key`; keep it private and retain it with the database so encrypted registration documents remain readable.

## Backend API

- `POST /api/auth/request-otp`, `POST /api/auth/verify-otp`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/session`
- `POST /api/auth/request-password-setup-otp`, `POST /api/auth/complete-password-setup` for existing legacy accounts without a password.
- `GET /api/locations` returns all state options and the district list for the selected state.
- `GET /api/bootstrap` returns the signed-in account's marketplace, prices, messages, orders, and requirements.
- `GET /api/market-prices?state=...` returns cached official AGMARKNET daily wholesale price records for the selected state.
- `POST /api/listings`, `PATCH /api/listings/:id`, `DELETE /api/listings/:id`
- `POST /api/orders`, `POST /api/messages`, `POST /api/requirements`, `PATCH /api/profile`

## Current integration limits

- OTP is a fixed development code; no SMS provider is connected. In `NODE_ENV=production`, new account creation and legacy account setup are disabled until an SMS provider is integrated. Password login remains available.
- For production, provide `IDENTITY_ENCRYPTION_KEY` as 64 hexadecimal characters (32 bytes). Do not commit or share this key.
- Crop photos support JPG, PNG, and WebP files up to 2 MB and are stored with listings in SQLite.
- Payments, escrow, payouts, KYC/Aadhaar checks, and logistics tracking are not connected.
- Market prices are official daily reports, not tick-by-tick trading quotes. They require a personal `DATA_GOV_API_KEY` and are refreshed from the source at most once every ten minutes per state.
- The app starts without demo accounts, listings, messages, orders, requirements, or market prices.
- Sessions use an HttpOnly cookie. Messages are stored by the app server and are not end-to-end encrypted.
- This is an MVP scaffold; complete a production security, privacy, deployment, and provider review before handling real transactions or identity documents.

## Location data

State and district dropdown options are stored in india-locations.json and served by the app API. The district list is based on the IGOD-derived Indian state and district dataset (https://github.com/KTBsomen/Indian-state-district-json); administrative boundaries can change, so refresh this snapshot when the Government of India's Local Government Directory (https://lgdirectory.gov.in/) publishes updates.
