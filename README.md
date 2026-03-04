# Hackamined'26

A Next.js application with a full authentication system — email/password and Google OAuth — built with [better-auth](https://better-auth.com), [Prisma](https://prisma.io), [Neon PostgreSQL](https://neon.tech), and [shadcn/ui](https://ui.shadcn.com).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Auth | better-auth (email/password + Google OAuth) |
| ORM | Prisma v7 |
| Database | Neon PostgreSQL (cloud-hosted) |
| Package manager | Bun |

---

## Requirements

Install these before you begin:

- **Node.js** v20+ — [nodejs.org](https://nodejs.org)
- **Bun** — [bun.sh](https://bun.sh) or run `npm i -g bun`
- **Git** — [git-scm.com](https://git-scm.com)

> No local PostgreSQL needed — the database is cloud-hosted on Neon.

---

## Setup & Running Locally

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/hackamined26.git
cd hackamined26
```

### 2. Add the `.env` file

Create a `.env` file in the project root with the following variables (get values from the project owner):

```env
DATABASE_URL=postgresql://...

BETTER_AUTH_SECRET=your_secret
BETTER_AUTH_URL=http://localhost:3000

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### 3. Install dependencies

```bash
bun install
```

### 4. Generate Prisma client

```bash
bunx prisma generate
```

### 5. Start the development server

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Testing the Application

### Email / Password — Sign Up

1. Open [http://localhost:3000](http://localhost:3000)
2. Click the **Create Account** tab
3. Fill in your Name, Email, Password, and Confirm Password
4. Click **Create Account**
5. ✅ A green toast should appear: *"Account created! Welcome aboard 🎉"*

### Email / Password — Sign In

1. Click the **Sign In** tab
2. Enter the email and password you just registered with
3. Click **Sign In**
4. ✅ Toast: *"Welcome back! You're now signed in."*

### Google OAuth

1. Click **Continue with Google** on either tab
2. Complete the Google sign-in flow
3. ✅ You'll be redirected back with a success toast

---

## Verifying Database Entries

After signing up, inspect the database with Prisma Studio:

```bash
bunx prisma studio
```

This opens a browser UI at [http://localhost:5555](http://localhost:5555). Check:

- **`user`** table — name, email, `emailVerified`, timestamps
- **`session`** table — active session token, expiry, IP address
- **`account`** table — provider (`credential` or `google`), linked `userId`

---

## Google OAuth Setup (for developers)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → **APIs & Services → OAuth consent screen** (External)
3. **Credentials → Create Credentials → OAuth client ID** (Web application)
4. Add this redirect URI:
   ```
   http://localhost:3000/api/auth/callback/google
   ```
5. Copy the **Client ID** and **Client Secret** into your `.env`

---

## Common Issues

| Problem | Fix |
|---|---|
| `bun: command not found` | Run `npm i -g bun` |
| Prisma client errors | Run `bunx prisma generate` |
| Google OAuth not working | Ensure the redirect URI is added in Google Console |
| Database connection error | Verify `.env` was copied correctly with no extra spaces |
