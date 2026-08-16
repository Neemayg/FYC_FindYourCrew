# FYC — Find Your Crew: Development Setup Guide

This document guides developers through setting up the **FYC** project foundation, database schema migrations, and local compilation.

---

## 1. Prerequisites
Ensure you have the following installed:
* **Node.js:** v18.x or later (v20.x recommended)
* **npm:** v10.x or later
* **Supabase account:** A free account on [supabase.com](https://supabase.com) to host the database and auth.

---

## 2. Installation
1. Navigate to the project directory:
   ```bash
   cd FYC
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```

---

## 3. Environment Variables Configuration
1. Copy the environment variables template:
   ```bash
   cp .env.example .env.local
   ```
2. Open `.env.local` and replace the placeholder values with your Supabase credentials:
   * `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase Project API URL.
   * `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase Project Anonymous API Key.

---

## 4. Supabase Setup & Database Migrations
1. Log into your Supabase Dashboard and create a new project called **FYC**.
2. Go to the **SQL Editor** panel in the Supabase Dashboard.
3. Open a new query window and paste the contents of our initial database migration file:
   [`supabase/migrations/20260816000000_initial_schema.sql`](file:///Users/neemaysmac/Desktop/FYC/supabase/migrations/20260816000000_initial_schema.sql)
4. Click **Run** to apply the schema migration.
5. Create a second query window, paste the contents of our incremental registration policy migration file:
   [`supabase/migrations/20260816000001_session_registration_policy.sql`](file:///Users/neemaysmac/Desktop/FYC/supabase/migrations/20260816000001_session_registration_policy.sql)
6. Click **Run** to apply the registration policy trigger.

---

## 5. Google OAuth Credentials Configuration
If you are deploying for testing or production, configure the Google Provider in Supabase Auth:

### 5.1 Google Cloud Console Steps
1. Open the [Google Cloud Console Credentials Screen](https://console.cloud.google.com/apis/credentials).
2. Create or select a project, then click **Create Credentials** > **OAuth client ID**.
3. Set Application Type to **Web application**.
4. Add the following to **Authorized redirect URIs**:
   * For Supabase authentication callback handling:
     `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
5. Click **Create** and copy the generated **Client ID** and **Client Secret**.

### 5.2 Supabase Dashboard Steps
1. Navigate to the **Authentication** > **Providers** panel in your Supabase Dashboard.
2. Toggle on the **Google** provider option.
3. Paste the **Client ID** and **Client Secret** copied from Google Cloud Console.
4. Under **Redirect URLs**, configure:
   * Site URL: `http://localhost:3000` (for local development) or `https://your-vercel-domain.vercel.app` (for production).
   * Redirect URI helpers: Ensure `/auth/callback` redirects are added.
5. Save the configuration.

---

## 6. Running the Application Locally
Launch the Next.js development server:
```bash
npm run dev
```
Open your browser and navigate to: [http://localhost:3000](http://localhost:3000)

---

## 7. Project Structure Overview
* [`app/`](file:///Users/neemaysmac/Desktop/FYC/app/): Next.js App Router folders. Contains page routes (`/`, `/student/register`, `/student/waiting`, `/admin/login`, `/admin/dashboard`).
* [`components/ui/`](file:///Users/neemaysmac/Desktop/FYC/components/ui/): Core reusable visual primitives (`Button.tsx`, `Card.tsx`, `Input.tsx`, `Badge.tsx`).
* [`lib/supabase/`](file:///Users/neemaysmac/Desktop/FYC/lib/supabase/): Database connection initializers (`client.ts` for browser, `server.ts` for server context).
* [`types/index.ts`](file:///Users/neemaysmac/Desktop/FYC/types/index.ts): Central TS domain declarations for enums, interfaces, and statuses.
* [`docs/`](file:///Users/neemaysmac/Desktop/FYC/docs/): Architecture specs, user flows, and roadmap.

---

## 8. How Stage 3 Will Continue
In Stage 3, we will implement the **Student Activity Interface**:
1. Implement real-time listeners for the student view to receive changes in `activity_sessions.status`.
2. Render scenario descriptions and choice selections (A/B/C/D) on the mobile device when the state transitions to `QUESTION_X`.
3. Save chosen selections using safe Server Actions.
