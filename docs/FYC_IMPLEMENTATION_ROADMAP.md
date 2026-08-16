# FYC — Find Your Crew: Implementation Roadmap

This document outlines the step-by-step roadmap to build, secure, optimize, and launch **FYC — Find Your Crew** across 12 sequential development stages.

---

## Stage 1: Project Foundation
* **Objective:** Establish the development environment, framework configuration, and styling skeleton.
* **Features:** Initial repository setup, Next.js page structure, Tailwind CSS integration, and Supabase client configuration.
* **Dependencies:** None.
* **Expected Output:** Working dev server on localhost displaying the landing page.
* **Testing Requirements:** Verify layout rendering and environment variable resolution.
* **Completion Criteria:** Next.js compiles without errors; tailwind configuration successfully generates CSS.

---

## Stage 2: Authentication & Participant Registration
* **Objective:** Securely register participants and bind them to the active session.
* **Features:** Supabase Google OAuth integration, registration form (Name, Branch, Year, Phone, Consent status), database insertion linking user to global `participants` and session-specific `session_participants`.
* **Dependencies:** Stage 1.
* **Expected Output:** Sign-in screen redirecting to Google OAuth and profile registration form.
* **Testing Requirements:** Validate email domains, phone formats, and session enrollment mapping.
* **Completion Criteria:** Successful user profile creation in the `participants` and `session_participants` database tables post-login.

---

## Stage 3: Student Activity Interface
* **Objective:** Build the reactive mobile-browser page for participants.
* **Features:** Lobby/waiting room UI, question/scenario answer buttons (A, B, C, D), lock statuses, and standby notification panels.
* **Dependencies:** Stage 2.
* **Expected Output:** Responsive student views that switch layout based on session state and standby conditions.
* **Testing Requirements:** Simulate UI rendering under simulated slow mobile network conditions.
* **Completion Criteria:** Student client responds to active session state variables (e.g. changing layouts).

---

## Stage 4: Admin Control Room & Live Synchronization
* **Objective:** Implement the session coordinator console and real-time network replication.
* **Features:** Admin session creation, state machine controls (Next, Back, Pause), Supabase Realtime subscriptions, and synchronized Projector view layout.
* **Dependencies:** Stage 3.
* **Expected Output:** Admin dashboard driving the projector screen layout and student UI state.
* **Testing Requirements:** Verify WebSocket reconnection and state persistence after tab reloads.
* **Completion Criteria:** Projector and student views update within 200ms of admin session changes.

---

## Stage 5: Response Collection & Server Validation
* **Objective:** Safely collect and record user choices for the 5 scenarios.
* **Features:** API response submission handler, unique constraint checks, current question verification, and locking on question expiry.
* **Dependencies:** Stage 4.
* **Expected Output:** Responses written to PostgreSQL; students blocked from double-answering or answering inactive questions.
* **Testing Requirements:** Verify that simulated requests to change a submitted answer or submit an inactive question fail on the server.
* **Completion Criteria:** Responses validated and recorded; attempts to write after state locks are blocked.

---

## Stage 6: Matching Engine & Group Formation
* **Objective:** Partition eligible students into compatible teams of 4 using deterministic algorithms.
* **Features:** Eligibility cutoff checks (setting remainder $R$ to standby), seeded PRNG matching logic, writing outputs to `groups` and `group_members`.
* **Dependencies:** Stage 5.
* **Expected Output:** Completed group lists, matching code assignments (e.g. `AP-47`), and matching engine performance report.
* **Testing Requirements:** Run unit tests for $N \pmod 4 \neq 0$ inputs, verifying standbys are excluded and matched count is divisible by 4.
* **Completion Criteria:** Matching runs under 3 seconds for 500 mock users, generating correct group sizes deterministically.

---

## Stage 7: Group Discovery & Verification
* **Objective:** Guide physical student matching and check-in confirmation.
* **Features:** Screen showing Group Code, check-in button, live check-in progress (e.g. "3/4 Checked In"), and database check-in triggers.
* **Dependencies:** Stage 6.
* **Expected Output:** Crew assembly UI; automatic group status updates when members click "Arrived".
* **Testing Requirements:** Verify that database trigger correctly marks groups verified when all members check in.
* **Completion Criteria:** Physical verification status flows to all group members and the admin panel in real-time.

---

## Stage 8: Real-Time Group Chat
* **Objective:** Enable ephemeral communication channels for checked-in cohorts.
* **Features:** Socket subscriptions to message tables, message inputs (max 500 chars), scroll-to-bottom mechanics, and message logging.
* **Dependencies:** Stage 7.
* **Expected Output:** Functional secure chat screen displaying messages from group peers.
* **Testing Requirements:** Confirm that members of Group A cannot send or read messages belonging to Group B.
* **Completion Criteria:** Instant message delivery to all online group members; database blocks unverified members.

---

## Stage 9: Security, RLS & Event Reliability
* **Objective:** Harden the system against bad actors and network anomalies.
* **Features:** Row Level Security (RLS) enforcement using `SECURITY DEFINER` recursion helpers, API rate limiting, and offline check-in overrides.
* **Dependencies:** Stage 8.
* **Expected Output:** Secure APIs, system logs, rate limit screens.
* **Testing Requirements:** Execute authorization tests attempting unauthorized database reads.
* **Completion Criteria:** All database access is locked down behind Supabase RLS; endpoints are rate-limited.

---

## Stage 10: Testing / Load Testing
* **Objective:** Verify operational stability at typical orientation crowds (100 - 500+ users).
* **Features:** Load-test scripts using k6 or Autocannon, concurrency simulations, database connection pooling tuning.
* **Dependencies:** Stage 9.
* **Expected Output:** Load report illustrating transaction response times and database CPU load.
* **Testing Requirements:** Load test with 500 simultaneous connections answering questions in parallel.
* **Completion Criteria:** API maintains p95 response time < 300ms under full load; no database connection exhaustion.

---

## Stage 11: UI/UX Polish & Appirates Branding
* **Objective:** Implement a premium theme aligning with Appirates.
* **Features:** Glassmorphism dashboard styles, color schemes (HSL custom palette), animated transitions, and custom SVGs.
* **Dependencies:** Stage 10.
* **Expected Output:** Polished, smooth frontend styling.
* **Testing Requirements:** Cross-browser rendering checks (Safari iOS, Chrome Android, Firefox, Chrome Desktop).
* **Completion Criteria:** Flawless visual styling on modern mobile viewports; responsive layouts operate without glitches.

---

## Stage 12: Final Event Deployment & Rehearsal
* **Objective:** Transition to the production cloud for the live presentation.
* **Features:** Production deploy on Vercel, Supabase custom domain linking, session management tests, and full end-to-end dry run.
* **Dependencies:** Stage 11.
* **Expected Output:** Production-ready domain URLs; completed checklist of dry-run procedures.
* **Testing Requirements:** Complete end-to-end orientation run simulation with 10 dummy phones.
* **Completion Criteria:** Successful walkthrough of the event flow from QR scan to chat completion.
