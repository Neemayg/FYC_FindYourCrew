'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Settings, Play, Database, ShieldAlert, LogOut, RefreshCw, Cpu, Users, CheckCircle, MessageSquare } from 'lucide-react';
import { updateSessionState, runSessionMatching } from './actions';
import { MatchingAuditLog } from '@/lib/matching/engine';

interface DashboardConsoleClientProps {
  session: {
    id: string;
    name: string;
    status: string;
    currentQuestionId: number | null;
  } | null;
}

export default function DashboardConsoleClient({
  session: initialSession,
}: DashboardConsoleClientProps) {
  const [session, setSession] = useState(initialSession);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<MatchingAuditLog | null>(null);

  // Admin group inspection states
  const [crews, setCrews] = useState<{
    id: string;
    groupCode: string;
    isVerified: boolean;
    checkedInCount: number;
    messageCount: number;
    members: {
      fullName: string;
      isCheckedIn: boolean;
    }[];
  }[]>([]);

  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/admin/login';
  };

  // Helper to fetch generated crews with check-in details and message counts
  const fetchAdminCrews = async () => {
    if (!session) return;
    const { data: groupsList } = await supabase
      .from('groups')
      .select(`
        id,
        group_code,
        is_verified,
        group_members (
          is_checked_in,
          participants (
            full_name
          )
        ),
        chat_messages (
          id
        )
      `)
      .eq('session_id', session.id)
      .order('group_code', { ascending: true });

    if (groupsList) {
      setCrews(
        groupsList.map((g: any) => {
          const membersList = g.group_members?.map((gm: any) => ({
            fullName: gm.participants?.full_name || 'Unknown',
            isCheckedIn: !!gm.is_checked_in,
          })) || [];
          
          const checkedInCount = membersList.filter((m: any) => m.isCheckedIn).length;
          const messageCount = g.chat_messages?.length || 0;

          return {
            id: g.id,
            groupCode: g.group_code,
            isVerified: !!g.is_verified,
            checkedInCount,
            messageCount,
            members: membersList,
          };
        })
      );
    }
  };

  // Real-time synchronization for admin monitoring
  useEffect(() => {
    if (!session?.id) return;

    const isRevealOrChat = session.status === 'GROUP_REVEAL' || session.status === 'GROUP_CHAT';
    if (isRevealOrChat) {
      fetchAdminCrews();

      const channel = supabase
        .channel('admin-groups-monitor')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'group_members',
          },
          () => {
            fetchAdminCrews();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'groups',
            filter: `session_id=eq.${session.id}`,
          },
          () => {
            fetchAdminCrews();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chat_messages',
          },
          () => {
            fetchAdminCrews();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      setCrews([]);
    }
  }, [session?.status, session?.id]);

  // Development helper to create a session if none exists
  const handleCreateDevSession = async () => {
    setIsLoading(true);
    setErrorMsg(null);

    const { data, error } = await supabase
      .from('activity_sessions')
      .insert({
        name: 'Appirates Test Session',
        status: 'LOBBY',
      })
      .select()
      .single();

    if (error) {
      console.error('Session creation failed:', error);
      setErrorMsg('Failed to create development session.');
      setIsLoading(false);
    } else {
      setSession({
        id: data.id,
        name: data.name,
        status: data.status,
        currentQuestionId: data.current_question_id,
      });
      setIsLoading(false);
    }
  };

  const handleStateTransition = async (targetState: string, questionId: number | null = null) => {
    if (!session) return;
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const result = await updateSessionState(session.id, targetState, questionId);
      if (result.success) {
        setSession({
          ...session,
          status: targetState,
          currentQuestionId: questionId,
        });
      } else {
        setErrorMsg(result.error ?? 'State transition failed.');
      }
    } catch (err) {
      console.error('State transition error:', err);
      setErrorMsg('Network error. Unable to transition session state.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunMatching = async () => {
    if (!session) return;
    setIsLoading(true);
    setErrorMsg(null);
    setAuditLog(null);

    try {
      const result = await runSessionMatching(session.id);
      if (result.success && result.auditLog) {
        setAuditLog(result.auditLog);
        setSession({
          ...session,
          status: 'MATCHING',
        });
      } else {
        setErrorMsg(result.error ?? 'Matching calculation failed.');
      }
    } catch (err) {
      console.error('Matching trigger failed:', err);
      setErrorMsg('Network error. Unable to connect to matching engine.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-grow max-w-7xl w-full mx-auto px-4 py-8">
      {/* Header bar */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-zinc-800 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold text-zinc-100 tracking-tight">
              FYC Control Room
            </h1>
            <Badge variant="info">Stage 7 Active Engine</Badge>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Active Session Management & State Operations
          </p>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded-xl transition-all duration-300 text-sm font-semibold cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          Disconnect
        </button>
      </header>

      {errorMsg && (
        <div className="p-4 bg-red-950/20 border border-red-950/30 rounded-xl text-red-400 text-sm font-medium mb-6">
          {errorMsg}
        </div>
      )}

      {/* Case: No session is active */}
      {!session ? (
        <div className="flex flex-col items-center justify-center p-12 bg-zinc-900/40 rounded-3xl border border-zinc-900 text-center space-y-6">
          <div className="p-4 bg-zinc-800/30 rounded-full border border-zinc-800 animate-pulse text-zinc-400">
            <RefreshCw className="h-10 w-10" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-zinc-100">No Active Session</h3>
            <p className="text-zinc-500 text-sm max-w-xs mx-auto mt-1">
              Initialize a session in the database to start testing the Question & Response Engine.
            </p>
          </div>
          <Button variant="primary" isLoading={isLoading} onClick={handleCreateDevSession}>
            Create Development Session
          </Button>
        </div>
      ) : (
        <>
          {/* Stats panel */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card>
              <CardHeader>
                <h3 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">
                  Active Session
                </h3>
                <Settings className="h-4 w-4 text-indigo-400" />
              </CardHeader>
              <p className="text-xl font-bold text-zinc-100 mt-2">{session.name}</p>
              <p className="text-xs text-zinc-500 mt-1">ID: {session.id}</p>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">
                  Question Coordinates
                </h3>
                <Database className="h-4 w-4 text-indigo-400" />
              </CardHeader>
              <p className="text-xl font-bold text-zinc-100 mt-2">
                {session.currentQuestionId ? `Question #${session.currentQuestionId}` : 'None'}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {session.currentQuestionId ? 'Timers active' : 'Timers stopped'}
              </p>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">
                  Current Game State
                </h3>
                <Play className="h-4 w-4 text-indigo-400" />
              </CardHeader>
              <p className="text-xl font-bold text-zinc-100 mt-2">{session.status}</p>
              <p className="text-xs text-zinc-500 mt-1">Broadcasting in real-time</p>
            </Card>
          </div>

          {/* Controller Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <Card>
              <CardHeader className="border-b border-zinc-900 pb-3 mb-4">
                <h2 className="text-lg font-bold text-zinc-200">Active State Controller</h2>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-zinc-500 text-xs leading-relaxed">
                  Click below to transition the session state. Advancing states triggers real-time events on student devices and projector slides.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  {/* General lobby return */}
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">
                      Session Entry
                    </h3>
                    <Button
                      variant={session.status === 'LOBBY' ? 'primary' : 'outline'}
                      size="sm"
                      isLoading={isLoading}
                      onClick={() => handleStateTransition('LOBBY')}
                    >
                      Open Lobby / Registration
                    </Button>
                  </div>

                  {/* Question sequence transitions */}
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">
                      Scenario Questions (Starts 30s Answering Timer)
                    </h3>
                    <div className="grid grid-cols-5 gap-1">
                      {[1, 2, 3, 4, 5].map((num) => (
                        <Button
                          key={num}
                          variant={session.status === `QUESTION_${num}` ? 'primary' : 'outline'}
                          size="sm"
                          className="px-1"
                          isLoading={isLoading}
                          onClick={() => handleStateTransition(`QUESTION_${num}`, num)}
                        >
                          Q{num}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Group Reveal transition */}
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">
                      Group Reveal
                    </h3>
                    <Button
                      variant={session.status === 'GROUP_REVEAL' ? 'primary' : 'outline'}
                      size="sm"
                      isLoading={isLoading}
                      onClick={() => handleStateTransition('GROUP_REVEAL')}
                    >
                      Trigger Group Reveal
                    </Button>
                  </div>

                  {/* Group Chat transition */}
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">
                      Group Chat
                    </h3>
                    <Button
                      variant={session.status === 'GROUP_CHAT' ? 'primary' : 'outline'}
                      size="sm"
                      isLoading={isLoading}
                      onClick={() => handleStateTransition('GROUP_CHAT')}
                    >
                      Trigger Group Chat
                    </Button>
                  </div>

                  {/* Complete session */}
                  <div className="col-span-2">
                    <h3 className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">
                      Lock Session
                    </h3>
                    <Button
                      variant={session.status === 'COMPLETED' ? 'primary' : 'outline'}
                      size="sm"
                      isLoading={isLoading}
                      onClick={() => handleStateTransition('COMPLETED')}
                    >
                      Complete Scenarios
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-zinc-900 pb-3 mb-4">
                <h2 className="text-lg font-bold text-zinc-200">Matching Engine Operations</h2>
              </CardHeader>
              <CardContent className="space-y-4 leading-relaxed">
                <p className="text-zinc-400 text-xs">
                  {session?.name?.toLowerCase().includes('rehearsal') ||
                  session?.name?.toLowerCase().includes('test') ||
                  session?.name?.toLowerCase().includes('demo') ? (
                    <span className="text-indigo-400 block font-semibold mb-1">
                      ★ Rehearsal Mode Active (Minimum 1 participant required)
                    </span>
                  ) : null}
                  Run the deterministic matching engine on response data. This runs greedy grouping, evaluates 5,000 swap options, and writes crews atomically.
                </p>
                <div className="flex items-start gap-3 p-4 bg-zinc-900/40 border border-zinc-900 rounded-2xl mb-4">
                  <ShieldAlert className="h-5 w-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-zinc-450 leading-relaxed">
                    This step moves participants to final status: registered, eligible, standby, or inactive. Verify answer completeness prior to trigger.
                  </p>
                </div>

                <Button
                  variant="primary"
                  fullWidth
                  className="gap-2"
                  isLoading={isLoading}
                  onClick={handleRunMatching}
                >
                  <Cpu className="h-4 w-4" />
                  Run Matching Engine
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Audit report panel */}
          {auditLog && (
            <Card className="w-full border-zinc-800 bg-zinc-950/40 mb-8">
              <CardHeader className="border-b border-zinc-900 pb-3 mb-4">
                <h2 className="text-lg font-bold text-zinc-200">Matching Audit Log Summary</h2>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
                  <div>
                    <span className="text-zinc-500 block">Total Registered:</span>
                    <strong className="text-zinc-200 text-base">{auditLog.numRegistered}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Incomplete Answers:</span>
                    <strong className="text-zinc-200 text-base">{auditLog.numIncomplete}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Matched Cohort:</span>
                    <strong className="text-zinc-200 text-base">{auditLog.numEligible}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Standby Count:</span>
                    <strong className="text-zinc-200 text-base">{auditLog.numStandby}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Groups Generated:</span>
                    <strong className="text-zinc-200 text-base">{auditLog.groupCount}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Execution Speed:</span>
                    <strong className="text-zinc-200 text-base">{auditLog.executionDurationMs} ms</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Deterministic Seed:</span>
                    <strong className="text-zinc-200 font-mono text-base">{auditLog.seedHex}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Optimization Iterations:</span>
                    <strong className="text-zinc-200 text-base">{auditLog.optimizationAttempts} swaps</strong>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Generated Crews Inspection Panel */}
          {crews.length > 0 && (
            <Card className="w-full border-zinc-800 bg-zinc-950/40">
              <CardHeader className="border-b border-zinc-900 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-indigo-400" />
                  <h2 className="text-lg font-bold text-zinc-200">Generated Crews ({crews.length})</h2>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {crews.map((crew) => (
                    <div
                      key={crew.id}
                      className="p-4 bg-zinc-900/40 border border-zinc-900 rounded-2xl space-y-3 hover:border-zinc-800 transition-all"
                    >
                      <div className="flex justify-between items-center">
                        <strong className="text-zinc-200 text-sm">{crew.groupCode}</strong>
                        
                        {crew.isVerified ? (
                          <Badge variant="success">Verified ({crew.members.length}/{crew.members.length})</Badge>
                        ) : crew.checkedInCount > 0 ? (
                          <Badge variant="zinc" className="bg-amber-950/20 text-amber-400 border border-amber-900/30">
                            Partial ({crew.checkedInCount}/{crew.members.length})
                          </Badge>
                        ) : (
                          <Badge variant="zinc">Waiting (0/{crew.members.length})</Badge>
                        )}
                      </div>
                      <div className="space-y-1.5 border-b border-zinc-900 pb-2 mb-2">
                        {crew.members.map((member, idx) => (
                          <p
                            key={idx}
                            className={`text-xs flex items-center justify-between ${
                              member.isCheckedIn ? 'text-emerald-400 font-medium' : 'text-zinc-500'
                            }`}
                          >
                            <span>• {member.fullName}</span>
                            {member.isCheckedIn && <CheckCircle className="h-3 w-3 text-emerald-400" />}
                          </p>
                        ))}
                      </div>
                      
                      {/* Message Count indicator */}
                      <div className="flex items-center gap-1.5 text-zinc-500 text-xs">
                        <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />
                        <span>{crew.messageCount} Messages sent</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
