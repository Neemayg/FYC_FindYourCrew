-- FYC — Find Your Crew: Flexible Group Verification Trigger
-- This migration updates the check_group_verification_trigger function
-- to compare verified check-in count with total group members (v_total)
-- rather than a hardcoded 4, supporting 1-member rehearsal/test sessions.

CREATE OR REPLACE FUNCTION public.check_group_verification_trigger()
RETURNS TRIGGER AS $$
DECLARE
    v_count INTEGER;
    v_total INTEGER;
BEGIN
    -- Count how many members of this group are currently checked in
    SELECT COUNT(*) INTO v_count
    FROM public.group_members
    WHERE group_id = NEW.group_id AND is_checked_in = TRUE;

    -- Count total members in this group
    SELECT COUNT(*) INTO v_total
    FROM public.group_members
    WHERE group_id = NEW.group_id;

    -- If all members have checked in, verify the group and enable chat
    IF v_count = v_total AND v_total > 0 THEN
        UPDATE public.groups
        SET is_verified = TRUE, chat_enabled = TRUE
        WHERE id = NEW.group_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
