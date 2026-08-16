-- FYC — Find Your Crew: Fix group_members RLS Policy & Clean Up Old Verification Triggers
-- Migration 05 refactored check-in to use is_checked_in and checked_in_at columns,
-- but the original update_my_verification RLS policy was left expecting updates to verified_at,
-- blocking all legitimate student check-ins. This patch corrects the policy.

-- 1. Drop old triggers and functions referencing verified_at
DROP TRIGGER IF EXISTS trigger_update_group_verification ON public.group_members;
DROP FUNCTION IF EXISTS public.check_group_verification();

-- 2. Re-create update_my_verification RLS policy to align with is_checked_in
DROP POLICY IF EXISTS update_my_verification ON public.group_members;
CREATE POLICY update_my_verification ON public.group_members
    FOR UPDATE USING (participant_id = auth.uid())
    WITH CHECK (
        participant_id = auth.uid() 
        AND is_checked_in = TRUE
    );
