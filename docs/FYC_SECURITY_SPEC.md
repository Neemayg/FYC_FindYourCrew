# FYC — Find Your Crew: Security Specification

This document details the security constraints, authorization models, PostgreSQL Row Level Security (RLS) policies, and response submission integrity models required to protect participant privacy and prevent system abuse.

---

## 1. Authentication

* **Platform:** Supabase Auth (Google OAuth).
* **Profile Setup:** Users authenticate via Google login. During sign-in, Next.js or database triggers insert a new row into `public.participants` populating `id`, `full_name`, and `email` using information from the OAuth payload.

---

## 2. Authorization & Roles

* **Admin:** Accesses the Admin Control Room dashboard, creates/manages activity sessions, modifies game state coordinates, triggers matching calculations, overrides check-ins, and moderates chat logs. Admin identity is verified using custom user claims check: `app_metadata.role == 'admin'`.
* **Participant (Student):** Authenticated user linked to `session_participants`. Can submit answers, update their physical check-in status, and send chat messages *only* within their assigned group of 4.

---

## 3. Supabase Row Level Security (RLS) & Recursion Fix

To prevent recursive policy evaluations (e.g., checking `group_members` membership by executing queries on `group_members` inside policies), we use a helper database function configured as `SECURITY DEFINER`. This function executes with the privileges of the database owner (bypassing RLS checks on `group_members`) but safely scopes query results to `auth.uid()`.

### 3.1 Security Helper Functions

```sql
-- Helper function to identify administrators
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- Recursive bypass helper: fetches all group IDs the authenticated user belongs to
CREATE OR REPLACE FUNCTION public.get_my_group_ids()
RETURNS TABLE (group_id UUID) AS $$
  SELECT gm.group_id 
  FROM public.group_members gm
  WHERE gm.participant_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
```

### 3.2 Table Policies

#### public.participants
* **Policy:** Anyone can register (insert) themselves. Students can view/edit their own profiles. Admins can view/edit all.
```sql
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_participant ON public.participants
FOR SELECT USING (auth.uid() = id OR public.is_admin());

CREATE POLICY insert_participant ON public.participants
FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY update_participant ON public.participants
FOR UPDATE USING (auth.uid() = id OR public.is_admin())
WITH CHECK (auth.uid() = id OR public.is_admin());
```

#### public.session_participants
* **Policy:** Students can read their own participation records; admins can view and edit all.
```sql
ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_session_participants ON public.session_participants
FOR SELECT USING (auth.uid() = participant_id OR public.is_admin());

CREATE POLICY admin_manage_session_participants ON public.session_participants
FOR ALL USING (public.is_admin());
```

#### public.group_members
* **Policy:** Students can view their own details and details of fellow crew members in their assigned group. Students can update their own `verified_at` column. Admins can manage all.
```sql
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_group_members ON public.group_members
FOR SELECT USING (
  participant_id = auth.uid() 
  OR group_id IN (SELECT public.get_my_group_ids())
  OR public.is_admin()
);

-- Students check themselves in by updating verified_at
CREATE POLICY update_my_checkin ON public.group_members
FOR UPDATE USING (participant_id = auth.uid())
WITH CHECK (
  participant_id = auth.uid() 
  AND verified_at IS NOT NULL
);

CREATE POLICY admin_manage_group_members ON public.group_members
FOR ALL USING (public.is_admin());
```

#### public.groups
* **Policy:** Students can read their own group details. Admins can manage all.
```sql
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_groups ON public.groups
FOR SELECT USING (
  id IN (SELECT public.get_my_group_ids()) 
  OR public.is_admin()
);

CREATE POLICY admin_manage_groups ON public.groups
FOR ALL USING (public.is_admin());
```

#### public.chat_messages
* **Policy:** Group members can read and send messages in their group chat. Admins can read and delete (moderate) all.
```sql
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Read messages: restricted to members of that specific group
CREATE POLICY select_chat ON public.chat_messages
FOR SELECT USING (
  group_id IN (SELECT public.get_my_group_ids())
  OR public.is_admin()
);

-- Send messages: restricted to group members where chat is enabled
CREATE POLICY insert_chat ON public.chat_messages
FOR INSERT WITH CHECK (
  sender_id = auth.uid()
  AND group_id IN (SELECT public.get_my_group_ids())
  AND EXISTS (
    SELECT 1 FROM public.groups 
    WHERE id = group_id AND chat_enabled = TRUE
  )
);

CREATE POLICY admin_manage_chat ON public.chat_messages
FOR ALL USING (public.is_admin());
```

---

## 4. Response Submission & Validation Integrity

To protect the response table from invalid inserts (e.g. submitting answers to future questions), validation is executed at the server API layer:

### 4.1 Unique Constraint
A database-level unique constraint is set on `responses(session_id, participant_id, question_id)`. Any duplicate submissions trigger a database error and are automatically blocked.

### 4.2 Submission Validation Flow
The API handler `/api/responses` enforces these validation rules before writing to the database:
1. **Auth Verification:** Extract the active participant's user UUID from the secure JWT cookie (`auth.uid()`).
2. **Eligibility Validation:** Fetch `session_participants` for the active `session_id`. Confirm their status is `ELIGIBLE` or `REGISTERED`. If they are set to `STANDBY` or `INACTIVE`, reject submission.
3. **Question State Validation:** Fetch `activity_sessions` matching `session_id`. Verify that:
   * The session state is set to `QUESTION_X` (where $X \in 1..5$).
   * The requested `question_id` matches the session's `current_question_id`.
4. **Time-Limit Enforcement:** Check that the current timestamp is within the window defined by the session's `timer_started_at + timer_duration` coordinates. If the time has expired, reject the submission.
5. **Option Validation:** Verify the chosen `selected_option` matches a configured letter ('A', 'B', 'C', or 'D') from the `options` table for that question.

---

## 5. Ephemeral Chat Security

* **Message Validation:** Max length checked at database level: `CHECK (char_length(message_text) <= 500)`. Strip HTML tags.
* **Rate Limiting:** Next.js Edge Middleware limits chat sends to 1 message per 2 seconds per user using a Redis token bucket.
* **Moderation:** A `Report Message` API allows students to flag messages, setting `is_reported = TRUE`. Reported messages are displayed on the Admin Control Room dashboard for moderation.
