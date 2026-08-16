'use client';

import React, { useEffect } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Users, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

interface WaitingRoomClientProps {
  session: {
    id: string;
    name: string;
    status: string;
  };
  participant: {
    fullName: string;
  };
}

export default function WaitingRoomClient({
  session,
  participant,
}: WaitingRoomClientProps) {
  const supabase = createClient();
  const router = useRouter();

  // Subscribe to realtime updates to automatically transition student to activity console
  useEffect(() => {
    const channel = supabase
      .channel('waiting-room-sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'activity_sessions',
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated.status !== 'LOBBY') {
            router.push('/student/activity');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session.id, supabase, router]);

  return (
    <div className="flex-grow flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10">
        <CardHeader className="flex flex-col items-center justify-center mb-6">
          <div className="h-16 w-16 bg-indigo-950/40 rounded-full flex items-center justify-center text-indigo-400 mb-4 border border-indigo-900/30">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
          <h2 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
            Waiting Room
          </h2>
          <p className="text-xs text-zinc-500 mt-1">FYC — Find Your Crew</p>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="text-zinc-200 font-bold text-lg">
              You're registered, {participant.fullName}!
            </p>
            <p className="text-zinc-400 font-light text-sm max-w-sm mx-auto leading-relaxed">
              Please keep this screen active. Once the event organizers launch the activity, your screen will update to let you submit option selections.
            </p>
          </div>

          <div className="p-4 bg-zinc-900/40 rounded-2xl border border-zinc-900 max-w-xs mx-auto flex items-center justify-center gap-3">
            <Users className="h-5 w-5 text-indigo-400 animate-pulse" />
            <span className="text-zinc-200 font-semibold text-sm">
              Waiting for activity to begin...
            </span>
          </div>

          <div className="flex justify-center gap-2 pt-2">
            <Badge variant="zinc">Session: {session.name}</Badge>
            <Badge variant="info">State: {session.status}</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
