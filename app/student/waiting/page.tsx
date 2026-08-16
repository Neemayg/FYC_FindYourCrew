import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import WaitingRoomClient from './WaitingRoomClient';

export default async function WaitingPage() {
  const supabase = await createClient();

  // 1. Fetch authenticated user details
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  // 2. Fetch participant global profile
  const { data: participant } = await supabase
    .from('participants')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (!participant) {
    redirect('/student/register');
  }

  // 3. Find active session (exclude completed and archived runs)
  const { data: activeSession } = await supabase
    .from('activity_sessions')
    .select('*')
    .neq('status', 'ARCHIVED')
    .neq('status', 'COMPLETED')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activeSession) {
    redirect('/student/register');
  }

  // 4. Verify participant is registered for this session
  const { data: registration } = await supabase
    .from('session_participants')
    .select('*')
    .eq('session_id', activeSession.id)
    .eq('participant_id', user.id)
    .maybeSingle();

  if (!registration) {
    redirect('/student/register');
  }

  // 5. If the session state has already advanced beyond the registration phase (LOBBY),
  // forward the student straight to the active question console.
  if (activeSession.status !== 'LOBBY') {
    redirect('/student/activity');
  }

  return (
    <WaitingRoomClient
      session={{
        id: activeSession.id,
        name: activeSession.name,
        status: activeSession.status,
      }}
      participant={{
        fullName: participant.full_name,
      }}
    />
  );
}
