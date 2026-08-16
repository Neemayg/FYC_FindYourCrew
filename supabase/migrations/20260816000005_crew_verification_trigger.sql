-- FYC — Find Your Crew: Crew Verification Trigger & Realtime Replication Migration

-- 0. Ensure group_members has the check-in columns (idempotent — safe to re-run)
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS is_checked_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

-- 1. Create verification count checking trigger function
CREATE OR REPLACE FUNCTION public.check_group_verification_trigger()
RETURNS TRIGGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Count how many members of this group are currently checked in
    SELECT COUNT(*) INTO v_count
    FROM public.group_members
    WHERE group_id = NEW.group_id AND is_checked_in = TRUE;

    -- If exactly 4, mark group as verified and enable chat for Stage 7
    IF v_count = 4 THEN
        UPDATE public.groups
        SET is_verified = TRUE, chat_enabled = TRUE
        WHERE id = NEW.group_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Bind trigger to group_members table
DROP TRIGGER IF EXISTS tr_check_group_verification ON public.group_members;
CREATE TRIGGER tr_check_group_verification
AFTER UPDATE OF is_checked_in ON public.group_members
FOR EACH ROW
WHEN (NEW.is_checked_in = TRUE AND OLD.is_checked_in = FALSE)
EXECUTE FUNCTION public.check_group_verification_trigger();

-- 3. Safely enable realtime replication on groups and group_members
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
        EXCEPTION WHEN duplicate_object THEN
            -- Ignore duplicate table warning
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
        EXCEPTION WHEN duplicate_object THEN
            -- Ignore duplicate table warning
        END;
    END IF;
END $$;
