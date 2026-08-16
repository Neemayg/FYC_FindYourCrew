'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export interface RegistrationResult {
  success: boolean;
  error?: string;
}

/**
 * Server Action to register an authenticated participant for a session.
 * Performs backend validation, checks session registration status,
 * upserts profile, and inserts session membership.
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

  // 1. Authenticate user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return { success: false, error: 'Unauthorized. Please login again.' };
  }

  // 2. Validate input fields
  const { fullName, phone, branch, year, consent, sessionId } = formData;

  if (!fullName || fullName.trim().length > 100) {
    return { success: false, error: 'Invalid name. Maximum 100 characters.' };
  }

  // Validate phone format (e.g. +919876543210 or 9876543210)
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

  // 3. Verify session exists and is accepting registrations
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

  // 4. Create or update global profile
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

  // 5. Register participant for session (or fetch if exists)
  const { error: registerError } = await supabase
    .from('session_participants')
    .insert({
      session_id: sessionId,
      participant_id: user.id,
      status: 'REGISTERED',
    });

  if (registerError) {
    // If user is already registered for this session, ignore duplicate key error and succeed
    if (registerError.code === '23505') {
      return { success: true };
    }
    console.error('Session registration error:', registerError);
    return { success: false, error: 'Failed to register for the active session.' };
  }

  return { success: true };
}
