-- FYC — Find Your Crew: Response Immutability RLS Patch
-- Stage 10.3C discovered that anon UPDATE and DELETE on the responses table
-- were unexpectedly permitted because no explicit UPDATE/DELETE policies existed.
-- Postgres with RLS enabled but no applicable policy falls back to DENY for
-- non-owner roles ONLY when the table is also FORCE ROW LEVEL SECURITY.
-- This migration closes both gaps.

-- 1. Force RLS even for table owners (belt-and-suspenders security)
ALTER TABLE public.responses FORCE ROW LEVEL SECURITY;

-- 2. Deny all UPDATE on responses for non-admins
--    Responses are immutable once inserted — no student or anon may change them.
DROP POLICY IF EXISTS deny_update_responses ON public.responses;
CREATE POLICY deny_update_responses ON public.responses
    FOR UPDATE USING (public.is_admin());

-- 3. Deny all DELETE on responses for non-admins
--    Only service-role/admin cleanup operations are permitted.
DROP POLICY IF EXISTS deny_delete_responses ON public.responses;
CREATE POLICY deny_delete_responses ON public.responses
    FOR DELETE USING (public.is_admin());

-- 4. Revoke UPDATE and DELETE table privileges from the Supabase anon and
--    authenticated roles at the PostgreSQL level.
--    FORCE ROW LEVEL SECURITY blocks the table owner, but granted role
--    privileges on Supabase bypass RLS policies for the anon role unless
--    explicitly revoked here.
REVOKE UPDATE ON public.responses FROM anon;
REVOKE DELETE ON public.responses FROM anon;
REVOKE UPDATE ON public.responses FROM authenticated;
REVOKE DELETE ON public.responses FROM authenticated;
