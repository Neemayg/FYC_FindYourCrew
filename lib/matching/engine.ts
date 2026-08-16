import { createClient } from '@/lib/supabase/server';
import { Candidate, GroupResult } from '@/types';
import { hashString, createPRNG } from './prng';
import { greedyInitialization, optimizeGroups } from './grouping';
import { validateGroups } from './validator';

export interface MatchingAuditLog {
  sessionId: string;
  numRegistered: number;
  numIncomplete: number;
  numEligible: number;
  numStandby: number;
  groupCount: number;
  initialScore: number;
  finalScore: number;
  optimizationAttempts: number;
  executionDurationMs: number;
  seedHex: string;
  timestamp: string;
}

/**
 * Main orchestrator executing the deterministic matching engine.
 * Fetches data, filters eligibility, executes greedy + local optimization phases,
 * validates correctness, and persists results atomically via PostgreSQL RPC.
 */
export async function runMatchingEngine(
  sessionId: string,
  supabaseClient?: any
): Promise<{ success: boolean; auditLog?: MatchingAuditLog; error?: string }> {
  const startTime = Date.now();
  const supabase = supabaseClient || await createClient();

  // 1. Fetch the active session to verify coordinates
  const { data: session, error: sessionError } = await supabase
    .from('activity_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    return { success: false, error: 'Session not found.' };
  }

  // Prevent duplicate matching operations
  if (
    session.status === 'MATCHING' ||
    session.status === 'GROUP_REVEAL' ||
    session.status === 'GROUP_CHAT' ||
    session.status === 'COMPLETED'
  ) {
    return { success: false, error: 'Matching has already been executed for this session.' };
  }

  // 2. Fetch all registered session participants with registration timestamps
  const { data: registrations, error: regError } = await supabase
    .from('session_participants')
    .select('participant_id, status, created_at')
    .eq('session_id', sessionId);

  if (regError || !registrations || registrations.length === 0) {
    return { success: false, error: 'No participants registered for this session.' };
  }

  // 3. Fetch all completed responses for this session
  const { data: responses, error: respError } = await supabase
    .from('responses')
    .select('participant_id, question_id, selected_option')
    .eq('session_id', sessionId);

  if (respError || !responses) {
    return { success: false, error: 'Failed to retrieve participant responses.' };
  }

  // 4. Fetch question weights from database
  const { data: questions } = await supabase
    .from('questions')
    .select('id, question_number, weight')
    .order('question_number', { ascending: true });

  const questionWeights = questions ? questions.map((q: { id: number; question_number: number; weight: number }) => Number(q.weight)) : [1.0, 1.0, 1.0, 1.0, 1.0];

  // Map question DB IDs to indices (0-4)
  const questionIdToIndexMap: Record<number, number> = {};
  if (questions) {
    questions.forEach((q: { id: number; question_number: number; weight: number }, idx: number) => {
      questionIdToIndexMap[q.id] = idx;
    });
  }

  // 5. Build Answer Vectors per participant
  const responseMap: Record<string, (string | null)[]> = {};
  responses.forEach((resp: { participant_id: string; question_id: number; selected_option: string }) => {
    if (!responseMap[resp.participant_id]) {
      responseMap[resp.participant_id] = [null, null, null, null, null];
    }
    const idx = questionIdToIndexMap[resp.question_id];
    if (idx !== undefined && idx >= 0 && idx < 5) {
      responseMap[resp.participant_id][idx] = resp.selected_option;
    }
  });

  // Filter candidates who have completed all 5 questions
  const completeCandidates: Candidate[] = [];
  const incompleteParticipantIds: string[] = [];

  registrations.forEach((reg: { participant_id: string; created_at: string }) => {
    const vector = responseMap[reg.participant_id];
    if (vector && vector.length === 5 && vector.every((ans) => ans !== null && ans !== undefined)) {
      completeCandidates.push({
        id: reg.participant_id,
        vector,
      });
    } else {
      incompleteParticipantIds.push(reg.participant_id);
    }
  });

  const numRegistered = registrations.length;
  const numIncomplete = incompleteParticipantIds.length;

  const isRehearsal = session.name.toLowerCase().includes('rehearsal') ||
                      session.name.toLowerCase().includes('test') ||
                      session.name.toLowerCase().includes('demo') ||
                      process.env.NODE_ENV === 'development';

  const minRequired = isRehearsal ? 1 : 4;

  if (completeCandidates.length < minRequired) {
    return {
      success: false,
      error: `Insufficient completed participants to match (need at least ${minRequired}, got ${completeCandidates.length}).`,
    };
  }

  // 6. Sort registrations deterministically (by created_at, fallback to participant_id UUID)
  const sortedRegs = [...registrations]
    .filter((reg) => !incompleteParticipantIds.includes(reg.participant_id))
    .sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return timeDiff !== 0 ? timeDiff : a.participant_id.localeCompare(b.participant_id);
    });

  // Calculate remainder cutoff R = N_c % 4
  const Nc = completeCandidates.length;
  const R = isRehearsal && Nc < 4 ? 0 : (Nc % 4);

  const standbyIds = new Set<string>();
  const eligibleMatchedIds = new Set<string>();

  // Mark latest R registered candidates as STANDBY
  const standbyRegIds: string[] = [];
  const eligibleRegIds: string[] = [];

  for (let i = 0; i < sortedRegs.length; i++) {
    const reg = sortedRegs[i];
    if (i >= sortedRegs.length - R) {
      standbyIds.add(reg.participant_id);
      standbyRegIds.push(reg.participant_id);
    } else {
      eligibleMatchedIds.add(reg.participant_id);
      eligibleRegIds.push(reg.participant_id);
    }
  }

  // Filter candidates cohort for matching
  const matchedCohort = completeCandidates.filter((c) => eligibleMatchedIds.has(c.id));

  // Update statuses in Supabase
  if (incompleteParticipantIds.length > 0) {
    await supabase
      .from('session_participants')
      .update({ status: 'INACTIVE' })
      .eq('session_id', sessionId)
      .in('participant_id', incompleteParticipantIds);
  }
  if (standbyRegIds.length > 0) {
    await supabase
      .from('session_participants')
      .update({ status: 'STANDBY' })
      .eq('session_id', sessionId)
      .in('participant_id', standbyRegIds);
  }
  if (eligibleRegIds.length > 0) {
    await supabase
      .from('session_participants')
      .update({ status: 'ELIGIBLE' })
      .eq('session_id', sessionId)
      .in('participant_id', eligibleRegIds);
  }

  // 7. Initialize Mulberry32 PRNG
  const seedString = sessionId + 'AP_FYC_SEED_CONST';
  const seed = hashString(seedString);
  const prng = createPRNG(seed);

  // 8. Phase 1: Greedy Initialization
  const initialGroups = greedyInitialization(matchedCohort, questionWeights);

  // Helper to calculate total global similarity
  const getGlobalScore = (grps: GroupResult[]) =>
    grps.reduce(
      (sum, g) =>
        sum +
        initialGroups.reduce(
          (subSum, refGroup) =>
            subSum +
            (refGroup.groupCode === g.groupCode
              ? g.members.reduce((mSum, m, idx) => {
                  let pairSum = 0;
                  for (let i = idx + 1; i < g.members.length; i++) {
                    const wSum = questionWeights.reduce((a: number, b: number) => a + b, 0);
                    let match = 0;
                    for (let q = 0; q < 5; q++) {
                      if (m.vector[q] === g.members[i].vector[q] && m.vector[q] !== null) {
                        match += questionWeights[q];
                      }
                    }
                    pairSum += wSum > 0 ? match / wSum : 0;
                  }
                  return mSum + pairSum;
                }, 0)
              : 0),
          0
        ),
      0
    );

  const initialScore = getGlobalScore(initialGroups);

  // 9. Phase 2: Hill-Climbing Optimization (5000 iterations)
  const optimizedGroups = optimizeGroups(initialGroups, 5000, prng, questionWeights);
  const finalScore = getGlobalScore(optimizedGroups);

  // 10. Run matching validation checks
  const validation = validateGroups(optimizedGroups, eligibleMatchedIds, standbyIds, isRehearsal);
  if (!validation.isValid) {
    return { success: false, error: validation.error || 'Matching validation failed.' };
  }

  // 11. Atomic Persistence via PostgreSQL PL/pgSQL function (RPC)
  const payload = optimizedGroups.map((g) => ({
    group_code: g.groupCode,
    members: g.members.map((m) => ({ id: m.id })),
  }));

  const { data: rpcSuccess, error: rpcError } = await supabase.rpc('persist_matching', {
    p_session_id: sessionId,
    p_groups: payload,
  });

  if (rpcError || !rpcSuccess) {
    console.error('RPC persist matching error:', rpcError);
    return { success: false, error: 'Database transaction failed during persistence.' };
  }

  // Update session state to MATCHING
  await supabase
    .from('activity_sessions')
    .update({ status: 'MATCHING' })
    .eq('id', sessionId);

  const executionDurationMs = Date.now() - startTime;

  const auditLog: MatchingAuditLog = {
    sessionId,
    numRegistered,
    numIncomplete,
    numEligible: eligibleMatchedIds.size,
    numStandby: standbyIds.size,
    groupCount: optimizedGroups.length,
    initialScore,
    finalScore,
    optimizationAttempts: 5000,
    executionDurationMs,
    seedHex: seed.toString(16),
    timestamp: new Date().toISOString(),
  };

  return { success: true, auditLog };
}
