-- FYC — Find Your Crew: Chat RLS Security Refinements Migration

-- 1. Drop existing policies
DROP POLICY IF EXISTS select_chat_messages ON public.chat_messages;
DROP POLICY IF EXISTS insert_chat_messages ON public.chat_messages;

-- 2. Create refined SELECT policy
CREATE POLICY select_chat_messages ON public.chat_messages
    FOR SELECT USING (
        (
            group_id IN (SELECT public.get_my_group_ids())
            AND EXISTS (
                SELECT 1 FROM public.groups
                WHERE id = group_id AND chat_enabled = TRUE AND is_verified = TRUE
            )
        )
        OR public.is_admin()
    );

-- 3. Create refined INSERT policy
CREATE POLICY insert_chat_messages ON public.chat_messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid()
        AND group_id IN (SELECT public.get_my_group_ids())
        AND EXISTS (
            SELECT 1 FROM public.groups
            WHERE id = group_id AND chat_enabled = TRUE AND is_verified = TRUE
        )
    );
