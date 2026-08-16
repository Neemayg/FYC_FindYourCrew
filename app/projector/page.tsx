'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Compass, Users, Video, Clock, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Question, Option } from '@/types';

export default function ProjectorPage() {
  const [session, setSession] = useState<{
    id: string;
    name: string;
    status: string;
    currentQuestionId: number | null;
    timerStartedAt: string | null;
    timerDuration: number | null;
  } | null>(null);

  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Group Verification aggregates
  const [stats, setStats] = useState<{ total: number; verified: number }>({ total: 0, verified: 0 });

  const supabase = createClient();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to fetch live verification aggregates
  const fetchVerificationStats = async (sid: string) => {
    const { data: groupsList } = await supabase
      .from('groups')
      .select('is_verified')
      .eq('session_id', sid);

    if (groupsList) {
      const total = groupsList.length;
      const verified = groupsList.filter((g) => g.is_verified).length;
      setStats({ total, verified });
    }
  };

  // 1. Fetch initially active session
  useEffect(() => {
    async function fetchActiveSession() {
      const { data, error } = await supabase
        .from('activity_sessions')
        .select('*')
        .neq('status', 'ARCHIVED')
        .neq('status', 'COMPLETED')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data && !error) {
        setSession({
          id: data.id,
          name: data.name,
          status: data.status,
          currentQuestionId: data.current_question_id,
          timerStartedAt: data.timer_started_at,
          timerDuration: data.timer_duration,
        });
        
        const isRevealOrChat = data.status === 'GROUP_REVEAL' || data.status === 'GROUP_CHAT';
        if (isRevealOrChat) {
          fetchVerificationStats(data.id);
        }
      }
      setIsLoading(false);
    }
    fetchActiveSession();
  }, []);

  // 2. Subscribe to real-time session changes
  useEffect(() => {
    if (!session?.id) return;

    const channel = supabase
      .channel('projector-session-sync')
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
          setSession({
            id: updated.id,
            name: updated.name,
            status: updated.status,
            currentQuestionId: updated.current_question_id,
            timerStartedAt: updated.timer_started_at,
            timerDuration: updated.timer_duration,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.id]);

  // 3. Subscribe to real-time group verification counts during reveal or chat phase
  const isRevealOrChat = session?.status === 'GROUP_REVEAL' || session?.status === 'GROUP_CHAT';
  useEffect(() => {
    if (!session?.id || !isRevealOrChat) return;

    fetchVerificationStats(session.id);

    const groupChannel = supabase
      .channel('projector-groups-sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'groups',
          filter: `session_id=eq.${session.id}`,
        },
        () => {
          fetchVerificationStats(session.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(groupChannel);
    };
  }, [session?.id, session?.status]);

  // 4. Fetch question details when active question transitions
  useEffect(() => {
    if (!session?.currentQuestionId) {
      setCurrentQuestion(null);
      setOptions([]);
      return;
    }

    async function fetchQuestionDetails() {
      const { data: question } = await supabase
        .from('questions')
        .select('*')
        .eq('id', session?.currentQuestionId)
        .single();

      const { data: optionList } = await supabase
        .from('options')
        .select('*')
        .eq('question_id', session?.currentQuestionId)
        .order('option_letter', { ascending: true });

      if (question) {
        setCurrentQuestion(question);
        
        // Trigger mock video play transition
        setIsVideoPlaying(true);
        setTimeout(() => {
          setIsVideoPlaying(false);
        }, 5000); // Mock plays clip for 5 seconds
      }
      if (optionList) {
        setOptions(optionList);
      }
    }
    fetchQuestionDetails();
  }, [session?.currentQuestionId]);

  // 5. Timer countdown hook
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (!session?.timerStartedAt || !session?.timerDuration || isVideoPlaying) {
      setTimeLeft(0);
      return;
    }

    const timerStarted = new Date(session.timerStartedAt).getTime();
    const duration = session.timerDuration * 1000;

    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((timerStarted + duration - now) / 1000));
      setTimeLeft(remaining);

      if (remaining <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
      }
    };

    tick();
    timerRef.current = setInterval(tick, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [session?.timerStartedAt, session?.timerDuration, isVideoPlaying]);

  if (isLoading) {
    return (
      <div className="flex-grow flex items-center justify-center bg-zinc-950 text-zinc-400">
        Loading Projector presentation...
      </div>
    );
  }

  // Lobby state presentation
  if (!session || session.status === 'LOBBY') {
    return (
      <div className="flex-grow flex flex-col items-center justify-center bg-zinc-950 text-center px-6 relative py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          <Badge variant="info" className="text-sm px-4 py-1.5">
            Appirates Orientations
          </Badge>
          
          <h1 className="text-6xl md:text-7xl font-extrabold text-zinc-50 tracking-tight leading-tight">
            FIND YOUR CREW
          </h1>
          
          <p className="text-xl md:text-2xl text-zinc-400 font-light max-w-2xl mx-auto leading-relaxed">
            Scan the QR code on your phone to register and join the lobby. We will launch the activity shortly.
          </p>

          <div className="p-8 bg-zinc-900/40 rounded-3xl border border-zinc-900 max-w-xs mx-auto flex flex-col items-center justify-center gap-4 shadow-xl">
            {/* Visual placeholder for join QR code */}
            <div className="w-48 h-48 bg-zinc-100 rounded-2xl flex items-center justify-center border border-zinc-800 text-zinc-900 font-bold p-4">
              <Compass className="h-24 w-24 text-indigo-900 animate-pulse" />
            </div>
            <span className="text-zinc-300 font-semibold text-sm">
              Lobby: {session ? session.name : 'Waiting for Session'}
            </span>
          </div>
        </div>

        <div className="absolute bottom-6 flex items-center gap-2 text-zinc-650 text-sm">
          <Users className="h-4 w-4" />
          Keep browser active. Driven by Appirates Admin.
        </div>
      </div>
    );
  }

  // Question phase presentation
  if (session.status.startsWith('QUESTION_') && currentQuestion) {
    return (
      <div className="flex-grow flex flex-col bg-zinc-950 px-8 py-10 justify-between min-h-screen">
        {/* Header */}
        <header className="flex justify-between items-center border-b border-zinc-900 pb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-extrabold tracking-tight text-zinc-300">
              {session.name}
            </h2>
            <Badge variant="info" className="text-xs">
              Question {currentQuestion.questionNumber} / 5
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-indigo-400" />
            <span className="text-xl font-mono font-bold text-zinc-100">
              {isVideoPlaying ? 'WATCH SCREEN' : timeLeft > 0 ? `${timeLeft}s` : "TIME'S UP"}
            </span>
          </div>
        </header>

        {/* Core display */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 my-8 items-center flex-grow">
          {/* Video stream placeholder */}
          <div className="h-[400px] bg-zinc-900 rounded-3xl border border-zinc-850 flex flex-col items-center justify-center gap-4 relative overflow-hidden shadow-2xl">
            {isVideoPlaying ? (
              <div className="absolute inset-0 bg-indigo-950/20 flex flex-col items-center justify-center text-center p-6 animate-pulse">
                <Video className="h-16 w-16 text-indigo-400 mb-4 animate-bounce" />
                <h3 className="text-2xl font-bold text-zinc-100 mb-2">Scenario Video Playing</h3>
                <p className="text-zinc-400 text-sm max-w-xs">Observe the server log crash simulation closely...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-6">
                <Video className="h-16 w-16 text-zinc-650 mb-4" />
                <h3 className="text-2xl font-bold text-zinc-400 mb-2">Answering Phase Open</h3>
                <p className="text-zinc-500 text-sm max-w-xs">Select your response option on your mobile screen.</p>
              </div>
            )}
          </div>

          {/* Question Text & Options */}
          <div className="flex flex-col gap-6">
            <h3 className="text-3xl font-extrabold text-zinc-100 leading-snug">
              {currentQuestion.questionText}
            </h3>

            {/* List options */}
            <div className="space-y-4">
              {options.map((opt) => (
                <Card
                  key={opt.id}
                  className="p-5 border-zinc-800 bg-zinc-900/30 flex items-start gap-4 transition-all duration-300 hover:border-zinc-700"
                >
                  <span className="h-8 w-8 rounded-lg bg-indigo-900/40 text-indigo-300 flex items-center justify-center font-bold text-sm border border-indigo-800/30 flex-shrink-0">
                    {opt.optionLetter}
                  </span>
                  <p className="text-zinc-300 font-medium text-base mt-1">
                    {opt.optionText}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-zinc-650 text-sm border-t border-zinc-900 pt-4">
          Streamed live in auditorium. Look at your phone console to select A, B, C, or D.
        </footer>
      </div>
    );
  }

  // Matching calculations presentation slide
  if (session.status === 'MATCHING') {
    return (
      <div className="flex-grow flex flex-col items-center justify-center bg-zinc-950 text-center px-6 py-12">
        <div className="max-w-xl mx-auto space-y-6">
          <div className="h-16 w-16 bg-indigo-950/40 rounded-full flex items-center justify-center text-indigo-400 mx-auto border border-indigo-900/30">
            <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
          </div>
          <h1 className="text-5xl font-extrabold text-zinc-50 tracking-tight leading-tight uppercase">
            Calculating Crews
          </h1>
          <p className="text-xl text-zinc-400 font-light max-w-sm mx-auto leading-relaxed">
            Evaluating pairwise compatibilities and optimizing groups. Please wait...
          </p>
        </div>
      </div>
    );
  }

  // Group reveal presentation slide (GROUP_REVEAL)
  if (session.status === 'GROUP_REVEAL') {
    return (
      <div className="flex-grow flex flex-col bg-zinc-950 px-8 py-10 justify-between min-h-screen relative overflow-hidden">
        {/* Subtle backdrop radial glows */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        
        {/* Header */}
        <header className="flex justify-between items-center border-b border-zinc-900 pb-4 z-10 relative">
          <h2 className="text-2xl font-extrabold tracking-tight text-zinc-300">
            {session.name}
          </h2>
          {session.timerStartedAt && session.timerDuration && (
            <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 rounded-xl border border-zinc-800">
              <Clock className="h-5 w-5 text-indigo-400" />
              <span className="text-xl font-mono font-bold text-zinc-100">
                {timeLeft > 0 ? `${timeLeft}s` : 'Verification Closed'}
              </span>
            </div>
          )}
        </header>

        {/* Core reveal dashboard */}
        <div className="flex flex-col items-center justify-center text-center max-w-3xl mx-auto space-y-8 z-10 relative flex-grow">
          <Badge variant="success" className="text-sm px-4 py-1.5 animate-bounce">
            THE MATCH IS IN
          </Badge>
          
          <h1 className="text-6xl md:text-7xl font-black text-zinc-50 tracking-tight leading-tight">
            FIND YOUR CREW
          </h1>
          
          <p className="text-xl md:text-2xl text-zinc-400 font-light max-w-2xl mx-auto leading-relaxed">
            Locate your 3 teammates. Gather physically and type your unique **Crew Code** to lock verification.
          </p>

          {/* Verification Progress board */}
          <div className="p-8 bg-zinc-900/40 rounded-3xl border border-zinc-900 w-full max-w-md mx-auto space-y-6 shadow-xl">
            <div>
              <span className="text-zinc-500 text-xs font-semibold uppercase tracking-wider block">
                Verification Progress
              </span>
              <strong className="text-zinc-100 text-4xl font-extrabold font-mono mt-1 block">
                {stats.verified} / {stats.total}
              </strong>
              <span className="text-xs text-zinc-450 block mt-1">Crews fully verified</span>
            </div>

            {/* Custom progress line */}
            <div className="w-full bg-zinc-950 rounded-full h-3 border border-zinc-900 overflow-hidden">
              <div
                className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${stats.total > 0 ? (stats.verified / stats.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-zinc-650 text-sm border-t border-zinc-900 pt-4 z-10 relative">
          Auditorium verification board. Excludes personal names and data to safeguard privacy.
        </footer>
      </div>
    );
  }

  // Group chat presentation slide (GROUP_CHAT)
  if (session.status === 'GROUP_CHAT') {
    return (
      <div className="flex-grow flex flex-col items-center justify-center bg-zinc-950 text-center px-6 py-12 relative overflow-hidden">
        {/* Subtle backdrop radial glows */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        
        <div className="max-w-3xl mx-auto space-y-8 relative z-10">
          <Badge variant="success" className="text-sm px-4 py-1.5 bg-emerald-950/20 text-emerald-400 border border-emerald-900/30">
            HUNT COMPLETED
          </Badge>
          
          <h1 className="text-6xl md:text-7xl font-black text-zinc-50 tracking-tight leading-tight">
            YOUR CREW HAS BEEN FOUND
          </h1>
          
          <p className="text-xl md:text-2xl text-zinc-400 font-light max-w-2xl mx-auto leading-relaxed">
            The crew hunt has ended! Use your phone's private group chat to coordinate and get to know your teammates.
          </p>
          
          <div className="pt-4">
            <div className="inline-flex items-center gap-3 text-zinc-500 text-sm bg-zinc-900/30 border border-zinc-900 px-6 py-3 rounded-full">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 animate-pulse" />
              <span>Crews Verified: {stats.verified} / {stats.total}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Completing slide presentation (COMPLETED)
  return (
    <div className="flex-grow flex flex-col items-center justify-center bg-zinc-950 text-center px-6 py-12">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="h-16 w-16 bg-emerald-950/40 rounded-full flex items-center justify-center text-emerald-400 mx-auto border border-emerald-900/30">
          <Compass className="h-8 w-8" />
        </div>
        <h1 className="text-5xl font-extrabold text-zinc-50 tracking-tight leading-tight">
          RESPONSES LOCKED
        </h1>
        <p className="text-xl text-zinc-400 font-light max-w-sm mx-auto leading-relaxed">
          The matching computations will begin shortly. Please get ready to physically assemble with your crew.
        </p>
      </div>
    </div>
  );
}
