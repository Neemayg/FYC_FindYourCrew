'use server';

import { createClient } from '@/lib/supabase/server';

export interface VerificationResponse {
  success: boolean;
  error?: string;
}

/**
 * Server Action to securely verify a student's physical check-in presence.
 * Validates session timelines, matches typed codes, and updates database check-in rows.
 */
export async function joinCrewVerification(
  sessionId: string,
  typedCode: string
): Promise<VerificationResponse> {
  const supabase = await createClient();

  // 1. Authenticate user session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please login again.' };
  }

  // 2. Fetch session data and verify parameters
  const { data: session } = await supabase
    .from('activity_sessions')
    .select('status, timer_started_at, timer_duration')
    .eq('id', sessionId)
    .single();

  if (!session) {
    return { success: false, error: 'Active session not found.' };
  }

  if (session.status !== 'GROUP_REVEAL') {
    return { success: false, error: 'Verification window is currently closed.' };
  }

  // Enforce session timeout constraints
  if (session.timer_started_at && session.timer_duration) {
    const timerStarted = new Date(session.timer_started_at).getTime();
    const now = Date.now();
    const expiry = timerStarted + session.timer_duration * 1000;
    if (now > expiry + 1500) {
      return { success: false, error: 'Verification period expired. Please contact coordinators.' };
    }
  }

  // 3. Resolve user group membership for the active session
  const { data: memberships, error: membershipError } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('participant_id', user.id);

  if (membershipError || !memberships || memberships.length === 0) {
    return { success: false, error: 'No group membership records found.' };
  }

  const groupIds = memberships.map((m) => m.group_id);

  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('id, group_code')
    .eq('session_id', sessionId)
    .in('id', groupIds)
    .maybeSingle();

  if (groupError || !group) {
    return { success: false, error: 'You are not matched to any group in this session.' };
  }

  // 4. Validate typed code matching (case-insensitive)
  if (group.group_code.trim().toUpperCase() !== typedCode.trim().toUpperCase()) {
    return { success: false, error: 'Incorrect crew code. You can only verify your own matched crew.' };
  }

  // 5. Update group check-in status (triggers database auto-verification checks)
  const { error: updateError } = await supabase
    .from('group_members')
    .update({
      is_checked_in: true,
      checked_in_at: new Date().toISOString(),
    })
    .eq('group_id', group.id)
    .eq('participant_id', user.id);

  if (updateError) {
    console.error('Check-in status update failed:', updateError);
    return { success: false, error: 'Failed to record your check-in presence.' };
  }

  return { success: true };
}
