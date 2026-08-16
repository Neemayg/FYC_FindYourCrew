'use server';

import { createClient } from '@/lib/supabase/server';

export interface ChatResponse {
  success: boolean;
  error?: string;
}

/**
 * Server Action to securely send a chat message to the verified crew channel.
 * Enforces session state, verification checks, rate-limiting, and text length rules.
 */
export async function sendChatMessage(
  sessionId: string,
  messageText: string
): Promise<ChatResponse> {
  const supabase = await createClient();

  // 1. Authenticate user details
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please login again.' };
  }

  // 2. Fetch session status and verify messaging coordinates
  const { data: session } = await supabase
    .from('activity_sessions')
    .select('status')
    .eq('id', sessionId)
    .single();

  if (!session) {
    return { success: false, error: 'FYC active session not found.' };
  }

  if (session.status !== 'GROUP_CHAT') {
    return { success: false, error: 'Crew chat is only accessible during the GROUP_CHAT phase.' };
  }

  // 3. Rate limiting check: max 5 messages per 10 seconds
  const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
  
  const { count, error: countError } = await supabase
    .from('chat_messages')
    .select('*', { count: 'exact', head: true })
    .eq('sender_id', user.id)
    .gte('created_at', tenSecondsAgo);

  if (countError) {
    console.error('Rate limit query failed:', countError);
    return { success: false, error: 'Failed to process security checks.' };
  }

  if (count !== null && count >= 5) {
    return {
      success: false,
      error: 'You are sending messages too quickly. Please wait a few seconds.',
    };
  }

  // 4. Resolve user's matched group coordinates
  const { data: memberships, error: membershipError } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('participant_id', user.id);

  if (membershipError || !memberships || memberships.length === 0) {
    return { success: false, error: 'You do not belong to any crew.' };
  }

  const groupIds = memberships.map((m) => m.group_id);

  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('id, is_verified, chat_enabled')
    .eq('session_id', sessionId)
    .in('id', groupIds)
    .maybeSingle();

  if (groupError || !group) {
    return { success: false, error: 'Crew coordinates not found for this session.' };
  }

  if (!group.is_verified || !group.chat_enabled) {
    return { success: false, error: 'Your crew has not completed physical verification.' };
  }

  // 5. Message text sanitization and validation
  const trimmed = messageText.trim();
  if (trimmed.length === 0) {
    return { success: false, error: 'Message cannot be empty.' };
  }

  if (trimmed.length > 500) {
    return { success: false, error: 'Message is too long (maximum 500 characters).' };
  }

  // 6. Insert message row safely (React renders text nodes safely, preventing XSS)
  const { error: insertError } = await supabase
    .from('chat_messages')
    .insert({
      group_id: group.id,
      sender_id: user.id,
      message_text: trimmed,
    });

  if (insertError) {
    console.error('Message insert failed:', insertError);
    return { success: false, error: 'Failed to broadcast your message.' };
  }

  return { success: true };
}
export async function getChatHistory(groupId: string): Promise<{ success: boolean; messages?: any[]; error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized.' };

  const { data: msgs, error: msgsError } = await supabase
    .from('chat_messages')
    .select('id, group_id, sender_id, message_text, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
    .limit(100);

  if (msgsError) {
    console.error('Get chat history failed:', msgsError);
    return { success: false, error: 'Failed to retrieve message logs.' };
  }

  return { success: true, messages: msgs };
}
