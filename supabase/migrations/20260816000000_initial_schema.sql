-- FYC — Find Your Crew: Initial Database Schema Migration

-- =========================================================================
-- 1. SCHEMAS & CONFIGURATION
-- =========================================================================

-- Enforce standard timezone
SET timezone = 'UTC';

-- =========================================================================
-- 2. CORE TABLES
-- =========================================================================

-- Activity Sessions: partitions orientations, dry-runs, and rehearsals
CREATE TABLE public.activity_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'LOBBY' CHECK (
        status IN ('LOBBY', 'QUESTION_1', 'QUESTION_2', 'QUESTION_3', 'QUESTION_4', 'QUESTION_5', 'MATCHING', 'GROUP_REVEAL', 'GROUP_CHAT', 'COMPLETED', 'ARCHIVED')
    ),
    current_question_id INTEGER, -- FK declared later to resolve circular reference
    timer_started_at TIMESTAMPTZ,
    timer_duration INTEGER, -- duration in seconds
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global profiles for authenticated students (maps 1:1 with auth.users)
CREATE TABLE public.participants (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    branch VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL CHECK (year BETWEEN 1 AND 5),
    consent_status BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Session registration and cutoff eligibility state
CREATE TABLE public.session_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'REGISTERED' CHECK (
        status IN ('REGISTERED', 'ELIGIBLE', 'STANDBY', 'INACTIVE')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, participant_id)
);

-- Question bank definition
CREATE TABLE public.questions (
    id SERIAL PRIMARY KEY,
    question_number INTEGER NOT NULL UNIQUE CHECK (question_number BETWEEN 1 AND 5),
    question_text TEXT NOT NULL,
    weight NUMERIC(3, 2) NOT NULL DEFAULT 1.00 CHECK (weight >= 0.00)
);

-- Add current_question_id foreign key constraint to activity_sessions
ALTER TABLE public.activity_sessions 
ADD CONSTRAINT fk_sessions_current_question 
FOREIGN KEY (current_question_id) REFERENCES public.questions(id) ON DELETE SET NULL;

-- Multiple choice options for questions (A/B/C/D)
CREATE TABLE public.options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id INTEGER NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    option_letter CHAR(1) NOT NULL CHECK (option_letter IN ('A', 'B', 'C', 'D')),
    option_text TEXT NOT NULL,
    UNIQUE (question_id, option_letter)
);

-- Student response logs. Immutable once inserted.
CREATE TABLE public.responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    selected_option CHAR(1) NOT NULL CHECK (selected_option IN ('A', 'B', 'C', 'D')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, participant_id, question_id)
);

-- Group definitions computed by matching engine
CREATE TABLE public.groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.activity_sessions(id) ON DELETE CASCADE,
    group_code VARCHAR(10) NOT NULL, -- E.g., 'AP-47'
    is_verified BOOLEAN NOT NULL DEFAULT FALSE, -- True when all 4 check in
    chat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, group_code)
);

-- Group membership links
CREATE TABLE public.group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
    is_checked_in BOOLEAN NOT NULL DEFAULT FALSE,
    checked_in_at TIMESTAMPTZ,
    UNIQUE (group_id, participant_id)
);

-- Ephemeral chat messages log
CREATE TABLE public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
    message_text TEXT NOT NULL CHECK (char_length(message_text) <= 500),
    is_reported BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================================
-- 3. INDEXES
-- =========================================================================

CREATE INDEX idx_responses_session_lookup ON public.responses(session_id, participant_id);
CREATE INDEX idx_chat_group_time ON public.chat_messages(group_id, created_at DESC);
CREATE INDEX idx_group_code ON public.groups(session_id, group_code);

-- =========================================================================
-- 4. DATABASE AUTOMATION & TRIGGERS
-- =========================================================================

-- Trigger to automatically mark groups verified when all members check in
CREATE OR REPLACE FUNCTION public.check_group_verification()
RETURNS TRIGGER AS $$
DECLARE
    total_members INTEGER;
    verified_members INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_members
    FROM public.group_members
    WHERE group_id = NEW.group_id;

    SELECT COUNT(*) INTO verified_members
    FROM public.group_members
    WHERE group_id = NEW.group_id AND verified_at IS NOT NULL;

    -- Groups are strictly composed of exactly 4 members
    IF total_members = verified_members AND total_members = 4 THEN
        UPDATE public.groups
        SET is_verified = TRUE
        WHERE id = NEW.group_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trigger_update_group_verification
AFTER UPDATE OF verified_at ON public.group_members
FOR EACH ROW
EXECUTE FUNCTION public.check_group_verification();

-- =========================================================================
-- 5. ROW LEVEL SECURITY (RLS) & RECURSION BYPASS FUNCTIONS
-- =========================================================================

-- Helper: Check if user is administrator
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- Helper: Retrieve group IDs user belongs to, bypassing RLS to avoid policy recursion
CREATE OR REPLACE FUNCTION public.get_my_group_ids()
RETURNS TABLE (group_id UUID) AS $$
  SELECT gm.group_id 
  FROM public.group_members gm
  WHERE gm.participant_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- Enable RLS on all public tables
ALTER TABLE public.activity_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- 5.1 activity_sessions policies
CREATE POLICY select_sessions ON public.activity_sessions
    FOR SELECT USING (TRUE); -- All authenticated users can read the active session state

CREATE POLICY admin_manage_sessions ON public.activity_sessions
    FOR ALL USING (public.is_admin());

-- 5.2 participants policies
CREATE POLICY select_participant ON public.participants
    FOR SELECT USING (auth.uid() = id OR public.is_admin());

CREATE POLICY insert_participant ON public.participants
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY update_participant ON public.participants
    FOR UPDATE USING (auth.uid() = id OR public.is_admin())
    WITH CHECK (auth.uid() = id OR public.is_admin());

-- 5.3 session_participants policies
CREATE POLICY select_session_participants ON public.session_participants
    FOR SELECT USING (auth.uid() = participant_id OR public.is_admin());

CREATE POLICY admin_manage_session_participants ON public.session_participants
    FOR ALL USING (public.is_admin());

-- 5.4 questions and options policies (Read-only for users, Admin manage)
CREATE POLICY select_questions ON public.questions
    FOR SELECT USING (TRUE);

CREATE POLICY admin_manage_questions ON public.questions
    FOR ALL USING (public.is_admin());

CREATE POLICY select_options ON public.options
    FOR SELECT USING (TRUE);

CREATE POLICY admin_manage_options ON public.options
    FOR ALL USING (public.is_admin());

-- 5.5 responses policies
CREATE POLICY select_responses ON public.responses
    FOR SELECT USING (auth.uid() = participant_id OR public.is_admin());

-- Students submit responses for themselves. Insert integrity checks run at serverless API level.
CREATE POLICY insert_responses ON public.responses
    FOR INSERT WITH CHECK (auth.uid() = participant_id);

-- 5.6 group_members policies
CREATE POLICY select_group_members ON public.group_members
    FOR SELECT USING (
        participant_id = auth.uid()
        OR group_id IN (SELECT public.get_my_group_ids())
        OR public.is_admin()
    );

-- Students check themselves in by updating their own check-in timestamp
CREATE POLICY update_my_verification ON public.group_members
    FOR UPDATE USING (participant_id = auth.uid())
    WITH CHECK (
        participant_id = auth.uid() 
        AND verified_at IS NOT NULL
    );

CREATE POLICY admin_manage_group_members ON public.group_members
    FOR ALL USING (public.is_admin());

-- 5.7 groups policies
CREATE POLICY select_groups ON public.groups
    FOR SELECT USING (
        id IN (SELECT public.get_my_group_ids()) 
        OR public.is_admin()
    );

CREATE POLICY admin_manage_groups ON public.groups
    FOR ALL USING (public.is_admin());

-- 5.8 chat_messages policies
CREATE POLICY select_chat_messages ON public.chat_messages
    FOR SELECT USING (
        group_id IN (SELECT public.get_my_group_ids())
        OR public.is_admin()
    );

CREATE POLICY insert_chat_messages ON public.chat_messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid()
        AND group_id IN (SELECT public.get_my_group_ids())
        -- Restrict messaging to when admin has enabled chat for the group
        AND EXISTS (
            SELECT 1 FROM public.groups 
            WHERE id = group_id AND chat_enabled = TRUE
        )
    );

CREATE POLICY admin_manage_chat ON public.chat_messages
    FOR ALL USING (public.is_admin());
