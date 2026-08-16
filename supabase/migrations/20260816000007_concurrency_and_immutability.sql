-- FYC — Find Your Crew: Concurrency Locking and Group Immutability Migration

-- 1. Create session transition function with row locking
CREATE OR REPLACE FUNCTION public.transition_session_status(
    p_session_id UUID,
    p_target_status VARCHAR,
    p_question_id INTEGER,
    p_expected_current_statuses VARCHAR[]
)
RETURNS BOOLEAN AS $$
DECLARE
    v_current_status VARCHAR;
BEGIN
    -- Obtain row-level lock on the session to block concurrent requests
    SELECT status INTO v_current_status
    FROM public.activity_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Validate target transition origin bounds
    IF NOT (v_current_status = ANY(p_expected_current_statuses)) THEN
        RETURN FALSE;
    END IF;

    -- Update status coordinates atomically
    IF p_target_status LIKE 'QUESTION_%' AND p_question_id IS NOT NULL THEN
        UPDATE public.activity_sessions
        SET status = p_target_status,
            current_question_id = p_question_id,
            timer_started_at = NOW(),
            timer_duration = 30
        WHERE id = p_session_id;
    ELSE
        UPDATE public.activity_sessions
        SET status = p_target_status,
            current_question_id = NULL,
            timer_started_at = NULL,
            timer_duration = NULL
        WHERE id = p_session_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create group members immutability enforcement trigger function
CREATE OR REPLACE FUNCTION public.enforce_group_members_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- Abort updates that attempt to change group_id or participant_id coordinates
    IF OLD.group_id != NEW.group_id OR OLD.participant_id != NEW.participant_id THEN
        RAISE EXCEPTION 'Group membership is immutable and cannot be changed.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bind trigger BEFORE UPDATE to group_members table
DROP TRIGGER IF EXISTS tr_enforce_group_members_immutability ON public.group_members;
CREATE TRIGGER tr_enforce_group_members_immutability
BEFORE UPDATE ON public.group_members
FOR EACH ROW
EXECUTE FUNCTION public.enforce_group_members_immutability();
