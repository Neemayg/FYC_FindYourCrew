import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ActivityConsole from './ActivityConsole';
import { Question, Option } from '@/types';

export default async function StudentActivityPage() {
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
    .select('id, full_name')
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
    .select('status')
    .eq('session_id', activeSession.id)
    .eq('participant_id', user.id)
    .maybeSingle();

  if (!registration) {
    redirect('/student/register');
  }

  let currentQuestion: Question | null = null;
  let options: Option[] = [];
  let initialResponse: 'A' | 'B' | 'C' | 'D' | null = null;

  // 5. If active session is in a QUESTION state, load details
  if (activeSession.status.startsWith('QUESTION_') && activeSession.current_question_id) {
    const { data: question } = await supabase
      .from('questions')
      .select('*')
      .eq('id', activeSession.current_question_id)
      .single();

    const { data: optionList } = await supabase
      .from('options')
      .select('*')
      .eq('question_id', activeSession.current_question_id)
      .order('option_letter', { ascending: true });

    // Fetch existing response to handle page refresh / locked state
    const { data: resp } = await supabase
      .from('responses')
      .select('selected_option')
      .eq('session_id', activeSession.id)
      .eq('participant_id', user.id)
      .eq('question_id', activeSession.current_question_id)
      .maybeSingle();

    if (question) {
      currentQuestion = {
        id: question.id,
        questionNumber: question.question_number,
        questionText: question.question_text,
        weight: Number(question.weight),
      };
    }
    if (optionList) {
      options = optionList.map((opt: any) => ({
        id: opt.id,
        questionId: opt.question_id,
        optionLetter: opt.option_letter,
        optionText: opt.option_text,
      }));
    }
    if (resp) initialResponse = resp.selected_option as any;
  }

  return (
    <div className="flex-grow flex items-center justify-center px-4 py-12">
      <ActivityConsole
        session={{
          id: activeSession.id,
          name: activeSession.name,
          status: activeSession.status,
          timerStartedAt: activeSession.timer_started_at,
          timerDuration: activeSession.timer_duration,
          currentQuestionId: activeSession.current_question_id,
        }}
        participant={{
          id: participant.id,
          fullName: participant.full_name,
          registrationStatus: registration.status,
        }}
        initialQuestion={currentQuestion}
        initialOptions={options}
        initialResponse={initialResponse}
      />
    </div>
  );
}
