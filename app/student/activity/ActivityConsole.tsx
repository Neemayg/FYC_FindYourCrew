'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Compass, Users, Sparkles, Clock, CheckCircle2, ShieldAlert, Cpu, RefreshCw, Smartphone, Send, Lock } from 'lucide-react';
import { Question, Option } from '@/types';
import { submitResponse, getMyCrew, Teammate } from './actions';
import { joinCrewVerification } from './verificationActions';
import { sendChatMessage, getChatHistory } from './chatActions';

interface ActivityConsoleProps {
  session: {
    id: string;
    name: string;
    status: string;
    timerStartedAt: string | null;
    timerDuration: number | null;
    currentQuestionId: number | null;
  };
  participant: {
    id: string;
    fullName: string;
    registrationStatus: string;
  };
  initialQuestion: Question | null;
  initialOptions: Option[];
  initialResponse: 'A' | 'B' | 'C' | 'D' | null;
}

export default function ActivityConsole({
  session: initialSession,
  participant,
  initialQuestion,
  initialOptions,
  initialResponse,
}: ActivityConsoleProps) {
  const [session, setSession] = useState(initialSession);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(initialQuestion);
  const [options, setOptions] = useState<Option[]>(initialOptions);
  const [lockedOption, setLockedOption] = useState<'A' | 'B' | 'C' | 'D' | null>(initialResponse);

  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Group Reveal states
  const [crew, setCrew] = useState<{
    groupId: string;
    groupCode: string;
    isVerified: boolean;
    isCheckedIn: boolean;
    members: Teammate[];
  } | null>(null);
  const [crewError, setCrewError] = useState<string | null>(null);
  const [isCrewLoading, setIsCrewLoading] = useState<boolean>(false);

  // Verification Input state
  const [typedCode, setTypedCode] = useState<string>('');
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // Chat states
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatError, setChatError] = useState<string | null>(null);

  const supabase = createClient();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Helper to load crew parameters
  const fetchCrew = async () => {
    try {
      const res = await getMyCrew(session.id);
      if (res.success && res.groupId && res.groupCode && res.members) {
        setCrew({
          groupId: res.groupId,
          groupCode: res.groupCode,
          isVerified: !!res.isVerified,
          isCheckedIn: !!res.isCheckedIn,
          members: res.members,
        });
      } else {
        setCrewError(res.error ?? 'Failed to load crew.');
      }
    } catch (err) {
      console.error(err);
      setCrewError('Network error loading crew.');
    }
  };

  // 1. Subscribe to real-time session updates
  useEffect(() => {
    const channel = supabase
      .channel('student-session-sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'activity_sessions',
          filter: `id=eq.${session.id}`,
        },
        async (payload) => {
          const updated = payload.new as any;
          setSession({
            id: updated.id,
            name: updated.name,
            status: updated.status,
            currentQuestionId: updated.current_question_id,
            timerStartedAt: updated.timer_started_at,
            timerDuration: updated.timer_duration,
          });

          // Fetch new question details if transitioning question IDs
          if (updated.current_question_id) {
            const { data: newQ } = await supabase
              .from('questions')
              .select('*')
              .eq('id', updated.current_question_id)
              .single();

            const { data: newOpts } = await supabase
              .from('options')
              .select('*')
              .eq('question_id', updated.current_question_id)
              .order('option_letter', { ascending: true });

            // Fetch if the user already answered this new question
            const { data: resp } = await supabase
              .from('responses')
              .select('selected_option')
              .eq('session_id', session.id)
              .eq('participant_id', participant.id)
              .eq('question_id', updated.current_question_id)
              .maybeSingle();

            if (newQ) {
              setCurrentQuestion({
                id: newQ.id,
                questionNumber: newQ.question_number,
                questionText: newQ.question_text,
                weight: Number(newQ.weight),
              });
            } else {
              setCurrentQuestion(null);
            }

            const mappedOpts = newOpts ? newOpts.map((opt: any) => ({
              id: opt.id,
              questionId: opt.question_id,
              optionLetter: opt.option_letter,
              optionText: opt.option_text,
            })) : [];

            setOptions(mappedOpts);
            setLockedOption(resp?.selected_option as any || null);
            setErrorMsg(null);
          } else {
            setCurrentQuestion(null);
            setOptions([]);
            setLockedOption(null);
            setErrorMsg(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session.id]);

  // 2. Fetch crew details when state is GROUP_REVEAL or GROUP_CHAT
  const isRevealOrChat = session.status === 'GROUP_REVEAL' || session.status === 'GROUP_CHAT';
  useEffect(() => {
    if (isRevealOrChat && participant.registrationStatus === 'ELIGIBLE') {
      setIsCrewLoading(true);
      setCrewError(null);
      fetchCrew().finally(() => {
        setIsCrewLoading(false);
      });
    }
  }, [session.status, session.id, participant.registrationStatus]);

  // 3. Subscribe to real-time verification changes once crew is loaded
  useEffect(() => {
    if (!crew?.groupId) return;

    // Subscribes to check-in flags updates
    const membersChannel = supabase
      .channel('members-checkin-sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'group_members',
          filter: `group_id=eq.${crew.groupId}`,
        },
        () => {
          fetchCrew();
        }
      )
      .subscribe();

    // Subscribes to verified verification states
    const groupChannel = supabase
      .channel('group-verification-sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'groups',
          filter: `id=eq.${crew.groupId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          setCrew((prev) => (prev ? { ...prev, isVerified: updated.is_verified } : null));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(membersChannel);
      supabase.removeChannel(groupChannel);
    };
  }, [crew?.groupId]);

  // 4. Fetch chat history and subscribe to real-time messages in GROUP_CHAT phase
  useEffect(() => {
    if (session.status !== 'GROUP_CHAT' || !crew?.groupId || !crew?.isVerified) {
      setMessages([]);
      return;
    }

    // Load initial messages
    async function loadChatHistory() {
      const res = await getChatHistory(crew!.groupId);
      if (res.success && res.messages) {
        setMessages(res.messages);
      }
    }
    loadChatHistory();

    // Subscribe to new messages channel
    const chatChannel = supabase
      .channel(`crew-chat-feed-${crew.groupId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `group_id=eq.${crew.groupId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          setMessages((prev) => {
            // Remove the optimistic temporary message matching the same user and text content
            const filtered = prev.filter(
              (m) =>
                !(
                  m.id.startsWith('temp-') &&
                  m.sender_id === newMsg.sender_id &&
                  m.message_text === newMsg.message_text
                )
            );
            if (filtered.some((m) => m.id === newMsg.id)) return filtered;
            return [...filtered, newMsg];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chatChannel);
    };
  }, [session.status, crew?.groupId, crew?.isVerified]);

  // 5. Scroll chat to bottom ref hook
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 6. Local countdown timer hook
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (!session.timerStartedAt || !session.timerDuration) {
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
  }, [session.timerStartedAt, session.timerDuration]);

  // 7. Answer selection click handler
  const handleSelectOption = async (optionLetter: 'A' | 'B' | 'C' | 'D') => {
    if (lockedOption || isSubmitting || timeLeft <= 0) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await submitResponse({
        sessionId: session.id,
        questionId: currentQuestion!.id,
        selectedOption: optionLetter,
      });

      if (result.success) {
        setLockedOption(optionLetter);
      } else {
        setErrorMsg(result.error ?? 'Failed to submit response.');
      }
    } catch (err) {
      console.error('Response submit error:', err);
      setErrorMsg('Network error. Unable to record response.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 8. Verification code submission handler
  const handleVerifyCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerificationError(null);
    setIsSubmitting(true);

    try {
      const res = await joinCrewVerification(session.id, typedCode);
      if (res.success) {
        await fetchCrew();
      } else {
        setVerificationError(res.error ?? 'Verification failed.');
      }
    } catch (err) {
      console.error('Verification submit error:', err);
      setVerificationError('Network error. Unable to verify crew.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 9. Chat message submission handler
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isSubmitting) return;

    setChatError(null);
    const textToSend = chatInput;
    setChatInput('');
    setIsSubmitting(true);

    // Optimistically add the message to the local list
    const tempId = 'temp-' + Date.now();
    const tempMsg = {
      id: tempId,
      group_id: crew!.groupId,
      sender_id: participant.id,
      message_text: textToSend,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempMsg]);

    try {
      const res = await sendChatMessage(session.id, textToSend);
      if (!res.success) {
        setChatError(res.error ?? 'Failed to send message.');
        setChatInput(textToSend); // Restore text on failure
        // Remove optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    } catch (err) {
      console.error('Chat submit failed:', err);
      setChatError('Network error. Unable to send message.');
      setChatInput(textToSend);
      // Remove optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Standby or Inactive state rendering
  if (participant.registrationStatus === 'STANDBY' || participant.registrationStatus === 'INACTIVE') {
    return (
      <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10">
        <CardHeader className="flex flex-col items-center justify-center mb-6">
          <div className="h-16 w-16 bg-red-950/40 rounded-full flex items-center justify-center text-red-400 mb-4 border border-red-900/30">
            <ShieldAlert className="h-8 w-8 animate-pulse" />
          </div>
          <h2 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
            Standby Notice
          </h2>
          <p className="text-xs text-zinc-500 mt-1">{session.name}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-zinc-400 font-light max-w-sm mx-auto leading-relaxed">
            Hi {participant.fullName}, you are on standby for this round. Please report to the Appirates orientation desk to get assigned to a crew observer role or shadow team.
          </p>
          <Badge variant="danger">Status: Standby</Badge>
        </CardContent>
      </Card>
    );
  }

  // Lobby state rendering
  if (session.status === 'LOBBY') {
    return (
      <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10">
        <CardHeader className="flex flex-col items-center justify-center mb-6">
          <div className="h-16 w-16 bg-indigo-950/40 rounded-full flex items-center justify-center text-indigo-400 mb-4 border border-indigo-900/30 animate-pulse">
            <Compass className="h-8 w-8" />
          </div>
          <h2 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
            Lobby Active
          </h2>
          <p className="text-xs text-zinc-500 mt-1">{session.name}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-zinc-400 font-light max-w-sm mx-auto leading-relaxed">
            Welcome, {participant.fullName}! You are registered. Please watch the main auditorium screen. Scenarios will begin shortly.
          </p>
          <div className="flex justify-center gap-2">
            <Badge variant="zinc">Lobby open</Badge>
            <Badge variant="info">State: LOBBY</Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Question phase rendering
  if (session.status.startsWith('QUESTION_') && currentQuestion) {
    const isTimeUp = timeLeft <= 0;

    return (
      <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40">
        <CardHeader className="border-b border-zinc-850 pb-4 mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-zinc-100">
              Scenario {currentQuestion.questionNumber}
            </h2>
            <p className="text-xs text-zinc-500">Lock your answer choice</p>
          </div>

          <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 rounded-xl border border-zinc-800">
            <Clock className="h-4 w-4 text-indigo-400" />
            <span className="text-sm font-mono font-bold text-zinc-200">
              {isTimeUp ? "Time's up" : `${timeLeft}s`}
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {errorMsg && (
            <div className="p-4 bg-red-950/20 border border-red-950/30 rounded-xl text-red-400 text-sm font-medium">
              {errorMsg}
            </div>
          )}

          {/* Question Text */}
          <p className="text-zinc-200 font-medium text-base leading-relaxed">
            {currentQuestion.questionText}
          </p>

          {/* Answer locked panel */}
          {lockedOption ? (
            <div className="p-4 bg-emerald-950/10 border border-emerald-900/20 rounded-2xl flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-emerald-400">Response locked ✓</p>
                <p className="text-zinc-400 text-xs mt-0.5">
                  You selected Option {lockedOption}. Waiting for the next scenario.
                </p>
              </div>
            </div>
          ) : isTimeUp ? (
            <div className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-2xl text-center">
              <p className="text-xs font-semibold text-zinc-400">Answering period has ended.</p>
              <p className="text-zinc-500 text-xs mt-0.5">Watch the stage screen for the next step.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  disabled={isSubmitting}
                  onClick={() => handleSelectOption(opt.optionLetter)}
                  className="w-full text-left p-4 rounded-2xl bg-zinc-900/40 border border-zinc-900 hover:border-zinc-800 hover:bg-zinc-900 transition-all duration-300 flex items-start gap-4 active:scale-98 disabled:opacity-50"
                >
                  <span className="h-7 w-7 rounded-lg bg-indigo-950/60 text-indigo-400 flex items-center justify-center font-bold text-xs border border-indigo-900/30 flex-shrink-0">
                    {opt.optionLetter}
                  </span>
                  <span className="text-zinc-300 font-medium text-sm mt-0.5">
                    {opt.optionText}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Group Reveal State rendering
  if (session.status === 'GROUP_REVEAL') {
    if (isCrewLoading) {
      return (
        <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10">
          <CardHeader className="flex flex-col items-center justify-center mb-6">
            <RefreshCw className="h-8 w-8 text-indigo-400 animate-spin mb-4" />
            <h2 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
              Loading Your Crew
            </h2>
            <p className="text-xs text-zinc-500 mt-1">FYC — Find Your Crew</p>
          </CardHeader>
        </Card>
      );
    }

    if (crewError || !crew) {
      return (
        <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10">
          <CardHeader className="flex flex-col items-center justify-center mb-6">
            <ShieldAlert className="h-8 w-8 text-red-400 mb-4 animate-pulse" />
            <h2 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
              Reveal Error
            </h2>
            <p className="text-xs text-zinc-500 mt-1">FYC — Find Your Crew</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-zinc-400 font-light text-sm max-w-xs mx-auto leading-relaxed">
              {crewError || 'An unexpected error occurred while loading your match results.'}
            </p>
            <Badge variant="danger">System Error</Badge>
          </CardContent>
        </Card>
      );
    }

    // CASE A: Crew is fully verified (all 4 checked in)
    if (crew.isVerified) {
      return (
        <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10 relative overflow-hidden">
          <div className="absolute -top-16 -right-16 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl" />
          <CardHeader className="flex flex-col items-center justify-center mb-6">
            <div className="h-16 w-16 bg-emerald-950/40 rounded-full flex items-center justify-center text-emerald-400 mb-4 border border-emerald-900/30">
              <CheckCircle2 className="h-8 w-8 animate-bounce" />
            </div>
            <h2 className="text-xs font-semibold text-emerald-400 tracking-widest uppercase">
              Verification Locked
            </h2>
            <p className="text-3xl font-black text-zinc-50 tracking-tight mt-0.5">
              CREW VERIFIED
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-zinc-400 font-light max-w-sm mx-auto leading-relaxed text-sm">
              Congratulations! Your crew {crew.groupCode} has successfully gathered and verified. Ephemeral crew group chat will unlock in the next phase.
            </p>
            <div className="flex justify-center gap-2">
              <Badge variant="success">Verification Locked ✓</Badge>
            </div>
          </CardContent>
        </Card>
      );
    }

    // CASE B: Student has checked in, but waiting for other crew members
    if (crew.isCheckedIn) {
      return (
        <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40">
          <CardHeader className="border-b border-zinc-850 pb-4 mb-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xs font-semibold text-indigo-400 tracking-widest uppercase">
                  Lobby Verification
                </h2>
                <p className="text-2xl font-black text-zinc-50 tracking-tight mt-0.5">
                  CREW {crew.groupCode}
                </p>
              </div>
              {session.timerStartedAt && session.timerDuration && (
                <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 rounded-xl border border-zinc-800">
                  <Clock className="h-4 w-4 text-indigo-400" />
                  <span className="text-sm font-mono font-bold text-zinc-200">
                    {timeLeft > 0 ? `${timeLeft}s` : 'Expired'}
                  </span>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-200">
                Waiting for teammates...
              </h3>
              <p className="text-xs text-zinc-500">
                Ask your mates to input Crew Code: <strong>{crew.groupCode}</strong>.
              </p>
            </div>

            <div className="space-y-3">
              {/* Current user present */}
              <div className="p-4 bg-zinc-900/40 border border-zinc-900 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-7 w-7 rounded-full bg-indigo-900/40 text-indigo-400 flex items-center justify-center font-bold text-xs border border-indigo-900/20">
                    ✓
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200">
                      {participant.fullName} (You)
                    </h4>
                    <p className="text-xs text-zinc-500">Present</p>
                  </div>
                </div>
                <Badge variant="info">Joined</Badge>
              </div>

              {/* Teammates present status */}
              {crew.members.map((member, idx) => (
                <div
                  key={idx}
                  className="p-4 bg-zinc-900/40 border border-zinc-900 rounded-2xl flex items-center justify-between opacity-80"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-7 w-7 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center font-bold text-xs border border-zinc-700">
                      {member.isCheckedIn ? '✓' : idx + 1}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-zinc-200">
                        {member.fullName}
                      </h4>
                      <p className="text-xs text-zinc-500">
                        {member.isCheckedIn ? 'Present' : 'Finding teammate...'}
                      </p>
                    </div>
                  </div>

                  {member.isCheckedIn ? (
                    <Badge variant="info">Joined</Badge>
                  ) : (
                    <Badge variant="zinc">Waiting</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      );
    }

    // CASE C: Student needs to enter group code to verify presence
    return (
      <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40">
        <CardHeader className="border-b border-zinc-850 pb-4 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xs font-semibold text-indigo-400 tracking-widest uppercase">
                Find Your Crew
              </h2>
              <p className="text-2xl font-black text-zinc-50 tracking-tight mt-0.5">
                CREW HANDSHAKE
              </p>
            </div>
            {session.timerStartedAt && session.timerDuration && (
              <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 rounded-xl border border-zinc-800">
                <Clock className="h-4 w-4 text-indigo-400" />
                <span className="text-sm font-mono font-bold text-zinc-200">
                  {timeLeft > 0 ? `${timeLeft}s` : 'Expired'}
                </span>
              </div>
            )}
          </div>
        </CardHeader>

        <form onSubmit={handleVerifyCodeSubmit}>
          <CardContent className="space-y-6">
            {verificationError && (
              <div className="p-4 bg-red-950/20 border border-red-950/30 rounded-xl text-red-400 text-sm font-medium">
                {verificationError}
              </div>
            )}

            <p className="text-sm text-zinc-400 leading-relaxed font-light">
              Locate your 3 teammates. Once you gather in the auditorium, type your computed **Crew Code** to join verification.
            </p>
            <Input
              label="Enter Crew Code"
              placeholder="e.g. AP-07"
              required
              disabled={isSubmitting || (session.timerStartedAt ? timeLeft <= 0 : false)}
              value={typedCode}
              onChange={(e) => setTypedCode(e.target.value)}
            />

            <div className="p-4 bg-zinc-900/40 border border-zinc-900 rounded-2xl flex items-start gap-3">
              <Smartphone className="h-5 w-5 text-indigo-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-zinc-455 leading-relaxed">
                Verification checks that all 4 matched members enter the code. This locks your crew and activates future chat features.
              </p>
            </div>
          </CardContent>

          <div className="mt-6 flex flex-col gap-4">
            <Button
              type="submit"
              variant="primary"
              fullWidth
              isLoading={isSubmitting}
              disabled={session.timerStartedAt ? timeLeft <= 0 : false}
            >
              {session.timerStartedAt && timeLeft <= 0 ? 'Verification Expired' : 'Join Crew Verification'}
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  // Group Chat state rendering (GROUP_CHAT)
  if (session.status === 'GROUP_CHAT') {
    if (isCrewLoading) {
      return (
        <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10">
          <CardHeader className="flex flex-col items-center justify-center">
            <RefreshCw className="h-8 w-8 text-indigo-400 animate-spin mb-4" />
            <h2 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
              Initializing Chat
            </h2>
            <p className="text-xs text-zinc-500 mt-1">Please wait...</p>
          </CardHeader>
        </Card>
      );
    }

    // CASE A: Crew was not verified -> Chat locked
    if (!crew || !crew.isVerified) {
      return (
        <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-12">
          <CardHeader className="flex flex-col items-center justify-center mb-6">
            <div className="h-16 w-16 bg-red-950/40 rounded-full flex items-center justify-center text-red-400 mb-4 border border-red-900/30">
              <Lock className="h-8 w-8" />
            </div>
            <h2 className="text-xs font-semibold text-red-400 tracking-widest uppercase">
              Access Denied
            </h2>
            <p className="text-3xl font-black text-zinc-50 tracking-tight mt-0.5">
              CREW CHAT LOCKED
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-zinc-400 font-light text-sm max-w-xs mx-auto leading-relaxed">
              Find all 4 members of your crew and complete physical verification during the reveal phase to unlock your crew's private chat.
            </p>
            <Badge variant="danger">Status: Unverified</Badge>
          </CardContent>
        </Card>
      );
    }

    // CASE B: Crew is verified -> Renders Crew Chat Board
    return (
      <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 h-[600px] flex flex-col justify-between overflow-hidden">
        {/* Chat Header */}
        <CardHeader className="border-b border-zinc-850 pb-4 flex justify-between items-center bg-zinc-950/50 px-4 py-3 flex-shrink-0">
          <div>
            <h2 className="text-xs font-semibold text-indigo-400 tracking-widest uppercase">
              Crew Chat
            </h2>
            <p className="text-lg font-black text-zinc-50 tracking-tight">
              CREW {crew.groupCode}
            </p>
          </div>
          <Badge variant="success" className="text-xs px-2.5 py-0.5 font-mono">
            4 members
          </Badge>
        </CardHeader>

        {/* Message Feed list */}
        <div className="flex-grow p-4 overflow-y-auto space-y-3 bg-zinc-950/20">
          {chatError && (
            <div className="p-3 bg-red-950/20 border border-red-950/30 rounded-xl text-red-400 text-xs font-medium text-center">
              {chatError}
            </div>
          )}

          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-2 opacity-50 p-6">
              <Users className="h-8 w-8 text-indigo-400" />
              <p className="text-sm font-semibold text-zinc-300">Your crew chat is ready.</p>
              <p className="text-xs text-zinc-500">Say hello to your crew!</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === participant.id;
              
              // Resolve sender name
              let senderName = 'Unknown';
              if (isMe) {
                senderName = 'You';
              } else {
                const member = crew.members.find((m) => m.id === msg.sender_id);
                senderName = member ? member.fullName : 'Teammate';
              }

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col max-w-[85%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                >
                  <span className="text-[10px] text-zinc-500 font-semibold mb-0.5 px-1">
                    {senderName}
                  </span>
                  
                  <div
                    className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words font-medium ${
                      isMe
                        ? 'bg-indigo-650 text-zinc-50 rounded-tr-none border border-indigo-600'
                        : 'bg-zinc-900/60 text-zinc-300 rounded-tl-none border border-zinc-850'
                    }`}
                  >
                    {msg.message_text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Chat input submit footer */}
        <form
          onSubmit={handleSendChatMessage}
          className="p-3 border-t border-zinc-850 bg-zinc-950/60 flex gap-2 flex-shrink-0 items-center"
        >
          <input
            type="text"
            placeholder="Type a message to your crew..."
            className="flex-grow bg-zinc-900 border border-zinc-850 hover:border-zinc-800 focus:border-indigo-500 focus:outline-none rounded-xl text-sm px-4 py-2.5 text-zinc-100 transition-all placeholder-zinc-500 disabled:opacity-50"
            required
            disabled={isSubmitting}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={isSubmitting || !chatInput.trim()}
            className="h-10 w-10 bg-indigo-650 hover:bg-indigo-600 active:scale-95 text-zinc-50 border border-indigo-600 rounded-xl flex items-center justify-center transition-all disabled:opacity-50 cursor-pointer"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </Card>
    );
  }

  // Completion state rendering (COMPLETED)
  return (
    <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10">
      <CardHeader className="flex flex-col items-center justify-center mb-6">
        <div className="h-16 w-16 bg-emerald-950/40 rounded-full flex items-center justify-center text-emerald-400 mb-4 border border-emerald-900/30">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
          Responses Locked
        </h2>
        <p className="text-xs text-zinc-500 mt-1">FYC — Find Your Crew</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-zinc-400 font-light max-w-sm mx-auto leading-relaxed">
          All five scenarios completed. Get ready to physically Find Your Crew. The auditorium screen will announce the next step shortly.
        </p>
        <div className="flex justify-center gap-2">
          <Badge variant="success">Lock complete</Badge>
          <Badge variant="info">Session: {session.name}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
