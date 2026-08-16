-- FYC — Find Your Crew: Enable Realtime for Activity Sessions
-- This migration adds the activity_sessions table to the supabase_realtime publication
-- to allow WebSocket client subscriptions to receive real-time state transitions automatically.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
              AND schemaname = 'public' 
              AND tablename = 'activity_sessions'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_sessions;
        END IF;
    END IF;
END $$;
