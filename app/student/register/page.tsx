import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import RegisterForm from './RegisterForm';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import Link from 'next/link';

export default async function RegisterPage() {
  const supabase = await createClient();

  // 1. Fetch active session user details
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  // 2. Fetch participant global profile
  const { data: participant } = await supabase
    .from('participants')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  // 3. Find the currently active session (exclude completed and archived runs)
  const { data: activeSession } = await supabase
    .from('activity_sessions')
    .select('*')
    .neq('status', 'ARCHIVED')
    .neq('status', 'COMPLETED')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 4. Case: No session is currently running
  if (!activeSession) {
    return (
      <div className="flex-grow flex items-center justify-center px-4 py-12">
        <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10">
          <CardHeader className="flex flex-col items-center justify-center mb-6">
            <div className="h-16 w-16 bg-zinc-900/30 rounded-full flex items-center justify-center text-zinc-500 mb-4 border border-zinc-800/30 animate-pulse">
              <RefreshCw className="h-8 w-8 text-zinc-400" />
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
              Lobby Closed
            </h2>
            <p className="text-xs text-zinc-500 mt-1">FYC — Find Your Crew</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-zinc-400 font-light max-w-sm mx-auto leading-relaxed">
              No active session was found in the system. The event organizers have not launched the activity yet or the previous run was closed.
            </p>
            <Badge variant="zinc">Status: Waiting for Admin</Badge>
          </CardContent>
          <div className="mt-8">
            <Link
              href="/"
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
            >
              Back to landing page
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // 5. If profile exists, check if user is already registered for the active session
  if (participant) {
    const { data: registration } = await supabase
      .from('session_participants')
      .select('*')
      .eq('session_id', activeSession.id)
      .eq('participant_id', user.id)
      .maybeSingle();

    if (registration) {
      // User already registered! Forward straight to waitroom
      redirect('/student/waiting');
    }
  }

  // 6. Case: Active session is running, but registration is closed
  if (activeSession.status !== 'LOBBY') {
    return (
      <div className="flex-grow flex items-center justify-center px-4 py-12">
        <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10">
          <CardHeader className="flex flex-col items-center justify-center mb-6">
            <div className="h-16 w-16 bg-red-950/40 rounded-full flex items-center justify-center text-red-400 mb-4 border border-red-900/30">
              <ShieldAlert className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
              Registration Closed
            </h2>
            <p className="text-xs text-zinc-500 mt-1">FYC — Find Your Crew</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-zinc-400 font-light max-w-sm mx-auto leading-relaxed">
              Registration for this FYC session has closed. The activity is currently in progress. Please check with the Appirates coordinators for standby access.
            </p>
            <Badge variant="danger">Status: Closed</Badge>
          </CardContent>
          <div className="mt-8">
            <Link
              href="/"
              className="text-xs text-zinc-500 hover:text-zinc-400 font-semibold"
            >
              Back to home
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // 7. Render registration form passing Google profile detail props
  const userPayload = {
    id: user.id,
    email: user.email || '',
    fullName: user.user_metadata?.full_name || '',
  };

  return (
    <div className="flex-grow flex items-center justify-center px-4 py-12">
      <RegisterForm
        user={userPayload}
        sessionId={activeSession.id}
        sessionName={activeSession.name}
        sessionStatus={activeSession.status}
      />
    </div>
  );
}
