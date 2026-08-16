# FYC — Find Your Crew: Event-Day Runbook & Recovery Manual

This document outlines the step-by-step checklist and recovery protocols for orientation coordinators running the **FYC Orientation-Day Experience**.

---

## 1. Event Checklist

### Phase A: 2 Hours Before Event (Technical Setups)
* **[ ] Supabase Connection:** Access the Supabase dashboard. Ensure API responses are normal and database resource meters are nominal.
* **[ ] Environment Keys:** Verify that `.env.local` contains correct public keys and that secrets are securely set.
* **[ ] Google OAuth:** Run a test Google sign-in using an external mobile device. Confirm the callback executes successfully.
* **[ ] Scenario Questions:** Check that the 5 orientation scenarios are correctly populated in the `questions` and `options` tables.
* **[ ] Coordinator Control:** Log in to `/admin/dashboard` using administrator credentials. Verify session control buttons render.
* **[ ] Projector Display:** Open `/projector` on the main stage presentation computer. Confirm it displays the join QR code.

### Phase B: 15 Minutes Before Event (Student Lobby Entrance)
* **[ ] Stage Display:** Set the projector to fullscreen showing `/projector`. Confirm the lobby slide is visible.
* **[ ] Registrations Monitor:** Open the admin Control Room. Watch the "Registered Participants" count increment in real-time.
* **[ ] Network Latency:** Run a speed test on the auditorium Wi-Fi. Ensure latency is normal.
* **[ ] Backup Hotspot:** Keep an active backup cell hotspot on standby on the coordinator desk.

### Phase C: During Event (Scenarios and Response Engine)
* **[ ] Start Session:** Ensure the session state transitions to `LOBBY`.
* **[ ] Scenario Slides:** Click `Q1` on the control room to launch the first scenario. The projector shifts to show the timer.
* **[ ] Timer Monitoring:** Allow the 30-second answering countdown to run to zero. Verify student response indicators update.
* **[ ] Sequence Scenarios:** Repeat sequentially for questions `Q2` through `Q5`.
* **[ ] Registration Lock:** Once Q5 completes, announce registration lock. Click `Lock Session` to freeze registration entries.

### Phase D: Crew Matching & Reveal
* **[ ] Run Matching:** Click `Run Matching Engine`. Wait for calculations (typically under 100 milliseconds). Verify group totals and standby counts render.
* **[ ] Trigger Reveal:** Click `Trigger Group Reveal`. The main projector screen shifts to display: **THE MATCH IS IN. FIND YOUR CREW.**
* **[ ] Physical Gather:** Direct students to look at their phone screens, locate their Crew Code (e.g. `AP-07`), find their 3 teammates, and type the code to verify check-in.
* **[ ] Monitor Check-ins:** Watch the projector progress bar (e.g. `12 / 40 Crews Verified`) and admin dashboard checklists.
* **[ ] Open Chat:** Once check-ins plateau, transition session state by clicking `Trigger Group Chat`.

### Phase E: After Event
* **[ ] Archive Session:** Transition state to `ARCHIVED` to set historical logs to read-only.
* **[ ] Export Metrics:** Run matching audit log exports for coordinator reports.

---

## 2. Backup & Recovery Scenarios

| Failure Incident | Severity | Immediate Recovery Procedure |
| :--- | :--- | :--- |
| **Projector Computer Crashes** | Critical | 1. Swap projector cable to the admin backup laptop.<br>2. Open `/projector` and sign in.<br>3. Supabase Realtime will automatically restore the current session state slide. |
| **Auditorium Wi-Fi Disconnects** | Major | 1. Swap the administrator control machine to the pre-configured cellular hotspot.<br>2. Advise students over microphone to reload cellular data on their mobile phones. |
| **Student Phone Refreshes / Reloads** | Minor | 1. Student opens the web browser.<br>2. The application reads user session cookies, identifies auth tokens, and restores their exact coordinates (answer locked, crew card, or chat) instantly. |
| **Admin Clicks Twice (Double-Click)** | Low | 1. The database locks the session row atomically via PostgreSQL row locking (`transition_session_status`).<br>2. The second click is rejected, preventing double executions. |
| **Supabase Temporarily Unavailable** | Critical | 1. Direct students to continue finding their crew using physical namecards.<br>2. Once database connectivity recovers, check-ins can resume. |
