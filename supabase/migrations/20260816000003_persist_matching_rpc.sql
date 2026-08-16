-- FYC — Find Your Crew: Atomic Matching Persistence PL/pgSQL RPC Migration

CREATE OR REPLACE FUNCTION public.persist_matching(p_session_id UUID, p_groups JSONB)
RETURNS BOOLEAN AS $$
DECLARE
    g_record JSONB;
    m_record JSONB;
    v_group_id UUID;
BEGIN
    -- 1. Rematch Safety: Delete existing groups for this session.
    -- Foreign keys with ON DELETE CASCADE automatically purge corresponding group_members rows.
    DELETE FROM public.groups WHERE session_id = p_session_id;

    -- 2. Loop through each group in the input array
    FOR g_record IN SELECT * FROM jsonb_array_elements(p_groups) LOOP
        -- Insert a new group row
        INSERT INTO public.groups (session_id, group_code, is_verified, chat_enabled)
        VALUES (p_session_id, g_record->>'group_code', FALSE, FALSE)
        RETURNING id INTO v_group_id;

        -- 3. Loop through members in the current group record
        FOR m_record IN SELECT * FROM jsonb_array_elements(g_record->'members') LOOP
            -- Insert the mapping row connecting participant to group
            INSERT INTO public.group_members (group_id, participant_id, is_checked_in)
            VALUES (v_group_id, (m_record->>'id')::UUID, FALSE);
        END LOOP;
    END LOOP;

    RETURN TRUE;
EXCEPTION
    -- Rollback automatically on any standard DB exception
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Atomic matching persistence failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
