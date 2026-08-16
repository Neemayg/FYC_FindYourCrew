'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { runMatchingEngine, MatchingAuditLog } from '@/lib/matching/engine';

export interface ActionResponse {
  success: boolean;
  error?: string;
}

export interface MatchingActionResponse {
  success: boolean;
  auditLog?: MatchingAuditLog;
  error?: string;
}

/**
 * Server Action for admin operations.
 * Transitions session state machine, updates question ID coordinates,
 * and sets timer started timestamps.
 */
function getExpectedCurrentStatuses(targetState: string): string[] {
  switch (targetState) {
    case 'LOBBY':
      return ['LOBBY', 'ARCHIVED', 'COMPLETED', 'MATCHING', 'GROUP_REVEAL', 'GROUP_CHAT', 'QUESTION_1', 'QUESTION_2', 'QUESTION_3', 'QUESTION_4', 'QUESTION_5'];
    case 'QUESTION_1':
      return ['LOBBY', 'QUESTION_1'];
    case 'QUESTION_2':
      return ['QUESTION_1', 'QUESTION_2'];
    case 'QUESTION_3':
      return ['QUESTION_2', 'QUESTION_3'];
    case 'QUESTION_4':
      return ['QUESTION_3', 'QUESTION_4'];
    case 'QUESTION_5':
      return ['QUESTION_4', 'QUESTION_5'];
    case 'MATCHING':
      return ['QUESTION_5', 'COMPLETED'];
    case 'GROUP_REVEAL':
      return ['MATCHING', 'GROUP_REVEAL'];
    case 'GROUP_CHAT':
      return ['GROUP_REVEAL', 'GROUP_CHAT'];
    case 'COMPLETED':
      return ['GROUP_CHAT', 'COMPLETED'];
    case 'ARCHIVED':
      return ['COMPLETED', 'ARCHIVED'];
    default:
      return [];
  }
}

export async function updateSessionState(
  sessionId: string,
  targetState: string,
  questionId?: number | null
): Promise<ActionResponse> {
  const supabase = await createClient();

  // 1. Verify administrator credentials
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== 'admin') {
    return { success: false, error: 'Unauthorized. Admin role credentials required.' };
  }

  // 2. Transition session status via secure row locking RPC
  const { data: success, error: rpcError } = await supabase.rpc('transition_session_status', {
    p_session_id: sessionId,
    p_target_status: targetState,
    p_question_id: questionId ?? null,
    p_expected_current_statuses: getExpectedCurrentStatuses(targetState),
  });

  if (rpcError || !success) {
    console.error('Session transition failed:', rpcError);
    return {
      success: false,
      error: 'State transition rejected. Ensure matching state sequence is followed.',
    };
  }

  revalidatePath('/admin/dashboard');
  return { success: true };
}

/**
 * Server Action to trigger matching calculations for a session.
 */
export async function runSessionMatching(
  sessionId: string
): Promise<MatchingActionResponse> {
  const supabase = await createClient();

  // 1. Verify administrator credentials
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.role !== 'admin') {
    return { success: false, error: 'Unauthorized. Admin role credentials required.' };
  }

  // 2. Execute matching calculations
  const result = await runMatchingEngine(sessionId);

  if (result.success && result.auditLog) {
    revalidatePath('/admin/dashboard');
    return { success: true, auditLog: result.auditLog };
  }

  return { success: false, error: result.error || 'Matching calculation failed.' };
}
