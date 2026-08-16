'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export interface RegistrationResult {
  success: boolean;
  error?: string;
}

export interface SubmissionResult {
  success: boolean;
  error?: string;
}

export interface Teammate {
  id: string;
  fullName: string;
  branch: string;
  year: number;
  isCheckedIn: boolean;
}

export interface CrewResult {
  success: boolean;
  groupId?: string;
  groupCode?: string;
  isVerified?: boolean;
  isCheckedIn?: boolean;
  members?: Teammate[];
  error?: string;
}

/**
 * Server Action to register an authenticated participant for a session.
 */
export async function registerParticipant(formData: {
  fullName: string;
  phone: string;
  branch: string;
  year: number;
  consent: boolean;
  sessionId: string;
}): Promise<RegistrationResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return { success: false, error: 'Unauthorized. Please login again.' };
  }

  const { fullName, phone, branch, year, consent, sessionId } = formData;

  if (!fullName || fullName.trim().length > 100) {
    return { success: false, error: 'Invalid name. Maximum 100 characters.' };
  }

  const phoneRegex = /^\+?[0-9]{10,15}$/;
  if (!phone || !phoneRegex.test(phone.replace(/\s+/g, ''))) {
    return { success: false, error: 'Invalid phone number format. Must contain 10-15 digits.' };
  }

  if (!branch || branch.trim().length > 100) {
    return { success: false, error: 'Please specify a branch.' };
  }

  if (!year || year < 1 || year > 5) {
    return { success: false, error: 'Invalid year of study.' };
  }

  if (!consent) {
    return { success: false, error: 'You must provide consent to participate.' };
  }

  const { data: session, error: sessionError } = await supabase
    .from('activity_sessions')
    .select('status')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    return { success: false, error: 'Selected FYC session does not exist.' };
  }

  if (session.status !== 'LOBBY') {
    return { success: false, error: 'Registration for this FYC session has closed.' };
  }

  const { error: profileError } = await supabase
    .from('participants')
    .upsert({
      id: user.id,
      full_name: fullName.trim(),
      email: user.email,
      phone: phone.trim(),
      branch: branch.trim(),
      year: year,
      consent_status: consent,
    });

  if (profileError) {
    console.error('Profile creation error:', profileError);
    return { success: false, error: 'Failed to create student profile.' };
  }

  const { error: registerError } = await supabase
    .from('session_participants')
    .insert({
      session_id: sessionId,
      participant_id: user.id,
      status: 'REGISTERED',
    });

  if (registerError) {
    if (registerError.code === '23505') {
      return { success: true };
    }
    console.error('Session registration error:', registerError);
    return { success: false, error: 'Failed to register for the active session.' };
  }

  return { success: true };
}

/**
 * Server Action to securely submit a student's scenario response.
 */
export async function submitResponse(formData: {
  sessionId: string;
  questionId: number;
  selectedOption: 'A' | 'B' | 'C' | 'D';
}): Promise<SubmissionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please login again.' };
  }

  const { sessionId, questionId, selectedOption } = formData;

  const { data: participant } = await supabase
    .from('participants')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!participant) {
    return { success: false, error: 'Participant profile not found. Please register first.' };
  }

  const { data: registration } = await supabase
    .from('session_participants')
    .select('status')
    .eq('session_id', sessionId)
    .eq('participant_id', user.id)
    .maybeSingle();

  if (!registration) {
    return { success: false, error: 'You are not registered for this session.' };
  }

  if (registration.status === 'STANDBY' || registration.status === 'INACTIVE') {
    return { success: false, error: 'You are currently on standby and cannot submit answers.' };
  }

  const { data: session } = await supabase
    .from('activity_sessions')
    .select('status, current_question_id, timer_started_at, timer_duration')
    .eq('id', sessionId)
    .single();

  if (!session) {
    return { success: false, error: 'Active session not found.' };
  }

  const stateRegex = /^QUESTION_[1-5]$/;
  if (!stateRegex.test(session.status)) {
    return { success: false, error: 'Answering window is currently closed.' };
  }

  if (session.current_question_id !== questionId) {
    return { success: false, error: 'Submitted question does not match the active session question.' };
  }

  if (session.timer_started_at && session.timer_duration) {
    const timerStarted = new Date(session.timer_started_at).getTime();
    const now = Date.now();
    const expiry = timerStarted + session.timer_duration * 1000;
    
    if (now > expiry + 1500) {
      return { success: false, error: "Time's up. Answering window closed." };
    }
  } else {
    return { success: false, error: 'Question timer is not initialized.' };
  }

  const { data: option } = await supabase
    .from('options')
    .select('id')
    .eq('question_id', questionId)
    .eq('option_letter', selectedOption)
    .maybeSingle();

  if (!option) {
    return { success: false, error: 'Selected option is not valid for this question.' };
  }

  const { data: existingResponse } = await supabase
    .from('responses')
    .select('id')
    .eq('session_id', sessionId)
    .eq('participant_id', user.id)
    .eq('question_id', questionId)
    .maybeSingle();

  if (existingResponse) {
    return { success: false, error: 'Response already submitted.' };
  }

  const { error: insertError } = await supabase
    .from('responses')
    .insert({
      session_id: sessionId,
      participant_id: user.id,
      question_id: questionId,
      selected_option: selectedOption,
    });

  if (insertError) {
    if (insertError.code === '23505') {
      return { success: false, error: 'Response already submitted.' };
    }
    console.error('Response save failed:', insertError);
    return { success: false, error: 'Failed to record your answer.' };
  }

  return { success: true };
}

/**
 * Server Action to securely retrieve the current user's matched crew members.
 */
export async function getMyCrew(sessionId: string): Promise<CrewResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please login again.' };
  }

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
    .select('id, group_code, is_verified')
    .eq('session_id', sessionId)
    .in('id', groupIds)
    .maybeSingle();

  if (groupError || !group) {
    return { success: false, error: 'You have not been matched to a crew in this session.' };
  }

  const { data: groupMembers, error: membersError } = await supabase
    .from('group_members')
    .select('participant_id, is_checked_in')
    .eq('group_id', group.id);

  if (membersError || !groupMembers) {
    return { success: false, error: 'Failed to retrieve group members.' };
  }

  // Fetch session to check if rehearsal
  const { data: session } = await supabase
    .from('activity_sessions')
    .select('name')
    .eq('id', sessionId)
    .single();

  const isRehearsal = session && (
    session.name.toLowerCase().includes('rehearsal') ||
    session.name.toLowerCase().includes('test') ||
    session.name.toLowerCase().includes('demo') ||
    process.env.NODE_ENV === 'development'
  );

  const minRequired = isRehearsal ? 1 : 4;
  if (groupMembers.length < minRequired || groupMembers.length > 4) {
    return {
      success: false,
      error: `Inconsistent group size detected (${groupMembers.length} members). Please report to Appirates desk.`,
    };
  }

  const memberIds = groupMembers.map((gm) => gm.participant_id);
  const myGM = groupMembers.find((gm) => gm.participant_id === user.id);
  const isCheckedIn = myGM ? myGM.is_checked_in : false;

  const { data: profiles, error: profileError } = await supabase
    .from('participants')
    .select('id, full_name, branch, year')
    .in('id', memberIds);

  if (profileError || !profiles) {
    return { success: false, error: 'Failed to load crew profiles.' };
  }

  // Exclude current student from their list of people to find
  const teammates = profiles
    .filter((p) => p.id !== user.id)
    .map((p) => {
      const gm = groupMembers.find((member) => member.participant_id === p.id);
      return {
        id: p.id,
        fullName: p.full_name,
        branch: p.branch,
        year: p.year,
        isCheckedIn: gm ? gm.is_checked_in : false,
      };
    });

  return {
    success: true,
    groupId: group.id,
    groupCode: group.group_code,
    isVerified: group.is_verified,
    isCheckedIn,
    members: teammates,
  };
}
