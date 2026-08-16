-- FYC — Find Your Crew: Session Registration RLS Policy Migration

-- Enable student insertion into session_participants only if the session registration window is open (status = 'LOBBY')
CREATE POLICY insert_session_participants ON public.session_participants
    FOR INSERT WITH CHECK (
        auth.uid() = participant_id
        AND EXISTS (
            SELECT 1 FROM public.activity_sessions
            WHERE id = session_id AND status = 'LOBBY'
        )
    );
