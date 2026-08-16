# FYC — Find Your Crew: Architecture Decision Records (ADR)

This document tracks key design and architectural decisions made for **FYC — Find Your Crew**.

---

## ADR 1: Selection of Tech Stack (Next.js + Supabase + Tailwind)

### Status
Accepted.

### Context
We are starting with an empty workspace (greenfield project). The application requires secure authentication, real-time game state synchronization, data collection, matching calculations, and a real-time group chat. The deployment must be completed quickly with high performance and zero server maintenance overhead.

### Decision
Utilize the following stack:
* **Frontend:** Next.js (React) deployed on Vercel.
* **Database & Auth:** Supabase (PostgreSQL + Supabase Auth with Google OAuth).
* **Real-time:** Supabase Realtime Channels (WebSockets over Postgres replication).
* **Styling:** Tailwind CSS.

### Consequences
* **Pros:** Real-time listeners operate out-of-the-box without maintaining custom Node.js socket servers. Row Level Security (RLS) protects data at the DB level. High performance.
* **Cons:** Vendor lock-in on Supabase features, but easily exportable to raw Postgres if needed.

---

## ADR 2: Strict Group-of-4 with Eligibility Cutoff

### Status
Accepted (Revised from Groups of 5).

### Context
The original design proposed a "Groups of 5" fallback to handle participants count remainders ($N \% 4 \neq 0$). However, the orientation experience is strictly centered around "Find Your 3" (matching exactly 4 students per crew). Assigning 5 members to some groups violates the physical icebreaker format.

### Decision
Enforce a strict group-of-4 policy. If the number of active participants $N$ is not divisible by 4, the admin executes an eligibility cutoff. The $R = N \pmod 4$ latest registered participants are set to `STANDBY` status. The remaining $N'$ eligible students are matched into groups of exactly 4.

### Consequences
* **Pros:** Complete consistency of the "Find Your 3" experience.
* **Cons:** Standby students must be manually handled by the organizers (placed in shadow roles or helper tracks).

---

## ADR 3: Deterministic Matching Engine via Seeded PRNG

### Status
Accepted.

### Context
Using standard randomized swaps (`Math.random()`) in the greedy search and local swap engine leads to non-deterministic group assignments. If the matching calculation runs multiple times on the same input dataset, it would yield different groups, making live debugging and rematch requests highly chaotic.

### Decision
Initialize matching with a deterministic seed derived from hashing the current `session_id` combined with a fixed string. Replace all random choices in Phase 1 (greedy tie-breakers) and Phase 2 (local search swaps) with a seeded PRNG (such as Mulberry32).

### Consequences
* **Pros:** Identical answer inputs yield identical group allocations. Easy to re-run, debug, and trace results.
* **Cons:** Slightly more initial PRNG setup code, but runtime remains efficient.

---

## ADR 4: RLS Recursion Fix via Security Definer Helpers

### Status
Accepted.

### Context
Writing standard Supabase Row Level Security (RLS) policies on `group_members`, `groups`, and `chat_messages` tables requires querying `group_members` to verify user access. This triggers recursive policy evaluations (infinite loops) since PostgreSQL executes RLS on all subqueries of the target table.

### Decision
Create a SQL helper function `get_my_group_ids()` configured with the `SECURITY DEFINER` modifier and search path set to `public`. This function runs with database owner privileges, bypassing RLS evaluation inside policies and breaking the recursion loop.

### Consequences
* **Pros:** Secure, fast RLS evaluation. Standardizes permission policies without database lockups.
* **Cons:** Requires creating and maintaining custom SQL functions in the database migrations.

---

## ADR 5: Session-Based Database Partitioning

### Status
Accepted.

### Context
Developing and testing the application requires multiple dry-runs and dry run rehearsals. Having a single global activity state would require deleting all student responses and registration data before every run, preventing audit logs and debugging.

### Decision
Introduce the `activity_sessions` entity. All participants register to a specific session (`session_participants`), and matching, responses, groups, and chat messages are partitioned by `session_id`. Admin can create a new session at any time, archiving the previous one.

### Consequences
* **Pros:** Keeps testing data separate from live event data. Preserves history for debugging and auditing.
* **Cons:** Adds a foreign key join requirement on responses, groups, and session participant tables.
