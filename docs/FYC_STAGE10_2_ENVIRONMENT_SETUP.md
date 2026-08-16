# Stage 10.2 Environment Setup

## Objective
This document outlines the setup details, database credentials, Google OAuth configurations, and sequential migrations required to establish a safe **Staging Environment** for running FYC.

---

## Required Accounts
1. **Supabase Account:** Access to create staging projects and provision Postgres databases.
2. **Google Cloud Console Developer Account:** Access to create OAuth 2.0 Credentials (Client ID & Client Secret) for Google Sign-In.

---

## Required Credentials
The coordinator/developer must configure these staging credentials locally:
* **Supabase API Host URL:** Staging project database router endpoint.
* **Supabase Anon Public API Key:** Client publishable key.
* **Supabase Service Role Secret Key:** Server-only administrative key (used strictly inside test runner scripts to provision mock clients).
* **Google OAuth Client Credentials:** Authenticates students using active Google profiles.

---

## Environment Variables
Create a `.env.local` file in the project root containing the following parameters:

```env
# Public publishable credentials (accessible by client side Next.js)
NEXT_PUBLIC_SUPABASE_URL=https://<your-staging-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Server-only administrative key (DO NOT expose in client pages)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Supabase Setup
1. Create a new project in the Supabase Dashboard (e.g. `fyc-staging-orientation`).
2. Go to **Project Settings** ➔ **API** to copy the URL, Anon Key, and Service Role Key.

---

## Migration Order
Apply database migrations in the exact chronological dependency sequence:
1. **[`20260816000000_initial_schema.sql`](file:///Users/neemaysmac/Desktop/FYC/supabase/migrations/20260816000000_initial_schema.sql)** - Creates core tables, keys, and default indices.
2. **[`20260816000001_session_registration_policy.sql`](file:///Users/neemaysmac/Desktop/FYC/supabase/migrations/20260816000001_session_registration_policy.sql)** - Registers RLS policies on participants tables.
3. **[`20260816000002_seed_questions.sql`](file:///Users/neemaysmac/Desktop/FYC/supabase/migrations/20260816000002_seed_questions.sql)** - Seeds scenario question lists.
4. **[`20260816000003_persist_matching_rpc.sql`](file:///Users/neemaysmac/Desktop/FYC/supabase/migrations/20260816000003_persist_matching_rpc.sql)** - Declares groups atomic writing function.
5. **[`20260816000004_crew_profile_rls_policy.sql`](file:///Users/neemaysmac/Desktop/FYC/supabase/migrations/20260816000004_crew_profile_rls_policy.sql)** - Permits reading teammate profiles.
6. **[`20260816000005_crew_verification_trigger.sql`](file:///Users/neemaysmac/Desktop/FYC/supabase/migrations/20260816000005_crew_verification_trigger.sql)** - Atomically updates group verification flags.
7. **[`20260816000006_chat_security_rls.sql`](file:///Users/neemaysmac/Desktop/FYC/supabase/migrations/20260816000006_chat_security_rls.sql)** - Redefines private message policies.
8. **[`20260816000007_concurrency_and_immutability.sql`](file:///Users/neemaysmac/Desktop/FYC/supabase/migrations/20260816000007_concurrency_and_immutability.sql)** - Installs status locking transition RPCs and checks group columns.

---

## Google OAuth Setup
1. In Google Cloud Console, create an OAuth consent screen (Internal or External).
2. Create an **OAuth Client ID** of type **Web Application**.
3. Add the following redirect URI in **Authorized redirect URIs**:
   * Local: `http://localhost:3000/auth/callback`
   * Staging: `https://<staging-app-domain>.vercel.app/auth/callback`
4. Paste the Client ID and Secret key inside the Supabase Dashboard under **Authentication** ➔ **Providers** ➔ **Google**.

---

## Realtime Setup
The following tables must be added to the `supabase_realtime` publication stream:
* `activity_sessions` (syncs state machine)
* `groups` (syncs projector totals)
* `group_members` (syncs admin diagnostics)
* `chat_messages` (streams group messaging logs)

---

## Git Secret Protection
* `.env.local` is ignored globally inside **[`.gitignore`](file:///Users/neemaysmac/Desktop/FYC/.gitignore)** under pattern `.env*`.
* No hardcoded keys exist in the codebase; variables are fetched from environment contexts.

---

## Local Development Setup
1. Run `npm install` to setup node modules.
2. Run `npm run dev` to start local Hot-Reload Dev Servers.

---

## Staging Requirements
* Staging connection keys must be populated in `.env.local` prior to launching E2E rehearsals.

---

## Current Blockers
* **STAGING SUPABASE PROJECT REQUIRED:** No staging credentials exist inside `.env.local`.

---

## Next Execution Step
Provide the environment keys, launch staging database schemas, and trigger E2E orientation rehearsals.
