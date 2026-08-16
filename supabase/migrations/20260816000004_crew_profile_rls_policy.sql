-- FYC — Find Your Crew: Teammate Profiles RLS Policy Migration

-- Add select policy on participants table to let matched students read teammate details
CREATE POLICY select_crew_members ON public.participants
    FOR SELECT USING (
        id IN (
            SELECT participant_id FROM public.group_members
            WHERE group_id IN (SELECT public.get_my_group_ids())
        )
    );
