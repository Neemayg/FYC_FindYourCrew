import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashboardConsoleClient from './DashboardConsoleClient';

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  // 1. Authenticate user session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/admin/login');
  }

  // 2. Enforce admin role check securely on server
  if (user.app_metadata?.role !== 'admin') {
    redirect('/admin/login');
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

  const sessionPayload = activeSession
    ? {
        id: activeSession.id,
        name: activeSession.name,
        status: activeSession.status,
        currentQuestionId: activeSession.current_question_id,
      }
    : null;

  return <DashboardConsoleClient session={sessionPayload} />;
}
