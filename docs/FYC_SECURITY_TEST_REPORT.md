# FYC — Find Your Crew: Security & Penetration Test Report

This report documents the security validations, authorization constraints, and RLS checks conducted on the FYC database schema and Server Actions.

---

## Security Verification Matrix

| Category | Security Constraint | Expected Action | Status | Verification Notes |
| :--- | :--- | :--- | :--- | :--- |
| **AUTH** | Unauthenticated user access | Denied access to private screens | **VERIFIED** | Auth middleware redirects to landing |
| **AUTH** | Forged participant ID submission | Reject matching or registration | **VERIFIED** | Participant ID derived strictly on server from JWT |
| **AUTH** | Forged administrator transition | Transition state machine changes | **VERIFIED** | Checked `user.app_metadata.role === 'admin'` |
| **RLS** | Cross-session SELECT access | Block reading sessions data | **VERIFIED** | Regulated by session boundaries checks |
| **RLS** | Cross-group SELECT access | Block student A reading student B group | **VERIFIED** | Restricted to `groups.id IN (get_my_group_ids())` |
| **RLS** | Message insertion spoofing | Block posting into foreign chat | **VERIFIED** | Inserts require `group_id IN (get_my_group_ids())` |
| **RLS** | Message immutability | Block UPDATE or DELETE operations | **VERIFIED** | No update/delete policy for authenticated students |
| **MATCHING**| Duplicate execution attempts | Block concurrent matching triggers | **VERIFIED** | Session state verification prevents overrides |
| **MATCHING**| Manipulated candidate details | Block students modifying answers | **VERIFIED** | Trigger triggers locks once questions timer ends |
| **VERIFY** | Forged group verification | Block false crew checks | **VERIFIED** | Trigger checks `group_members` count matches 4 |
| **VERIFY** | Group membership manipulation | Block client modifying `group_id` | **VERIFIED** | Trigger `tr_enforce_group_members_immutability` blocks edits |
| **RATE** | Spam prevention chat logs | Block fast chat submits | **VERIFIED** | Enforces maximum 5 messages per 10 seconds |

---

## Security Assessment Results
* **Authenticated Sender Enforcement:** All student-facing Server Actions retrieve the user UUID from `supabase.auth.getUser()` on the server. Client-submitted IDs are never trusted.
* **Database Immutability Guards:** Handled via triggers:
  1. `tr_check_group_verification`: Enforces that crew verification status transitions atomically inside the database when check-in count reaches exactly 4.
  2. `tr_enforce_group_members_immutability`: Blocks updates changing group member associations, stopping client-side group spoofing.
* **RLS Integrity:** All tables have Row Level Security enabled. No wildcard policies exist.
