/**
 * FYC Stage 10.3C — Real Question Flow & Response Integrity Test
 *
 * Replicates exact logic of submitResponse() in
 * app/student/activity/actions.ts against the live staging database.
 *
 * NEVER prints secret keys or passwords.
 */

import fs from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  fs.readFileSync('.env.local', 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#\s=]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  });
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Colours ──────────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[34m', X = '\x1b[0m';
type Status = 'PASS' | 'FAIL' | 'NOT EXECUTED' | 'BLOCKED';
const results: Record<string, { status: Status; note: string }> = {};

function record(key: string, status: Status, note = '') {
  results[key] = { status, note };
  const col = status === 'PASS' ? G : status === 'FAIL' ? R : Y;
  console.log(`  ${col}${status}${X}  ${key}${note ? `  — ${note}` : ''}`);
}
function assertEq<T>(label: string, actual: T, expected: T) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  record(label, ok ? 'PASS' : 'FAIL',
    ok ? `got ${JSON.stringify(actual)}` : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return ok;
}

// ─── Clients ──────────────────────────────────────────────────────────────────
const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── submitResponse replica (mirrors actions.ts exactly, injected client) ─────
async function submitResponse(
  client: SupabaseClient,
  userId: string,
  formData: { sessionId: string; questionId: number; selectedOption: string }
): Promise<{ success: boolean; error?: string }> {
  const { sessionId, questionId, selectedOption } = formData;

  // 1. Participant profile check
  const { data: participant } = await client.from('participants')
    .select('id').eq('id', userId).maybeSingle();
  if (!participant) return { success: false, error: 'Participant profile not found. Please register first.' };

  // 2. Registration check
  const { data: registration } = await client.from('session_participants')
    .select('status').eq('session_id', sessionId).eq('participant_id', userId).maybeSingle();
  if (!registration) return { success: false, error: 'You are not registered for this session.' };
  if (registration.status === 'STANDBY' || registration.status === 'INACTIVE')
    return { success: false, error: 'You are currently on standby and cannot submit answers.' };

  // 3. Session state check
  const { data: session } = await client.from('activity_sessions')
    .select('status, current_question_id, timer_started_at, timer_duration')
    .eq('id', sessionId).single();
  if (!session) return { success: false, error: 'Active session not found.' };

  const stateRegex = /^QUESTION_[1-5]$/;
  if (!stateRegex.test(session.status))
    return { success: false, error: 'Answering window is currently closed.' };

  // 4. Current question match
  if (session.current_question_id !== questionId)
    return { success: false, error: 'Submitted question does not match the active session question.' };

  // 5. Timer check (mirrors actions.ts — 1500ms grace)
  if (session.timer_started_at && session.timer_duration) {
    const timerStarted = new Date(session.timer_started_at).getTime();
    const now = Date.now();
    const expiry = timerStarted + session.timer_duration * 1000;
    if (now > expiry + 1500) return { success: false, error: "Time's up. Answering window closed." };
  } else {
    return { success: false, error: 'Question timer is not initialized.' };
  }

  // 6. Option validity check
  const { data: option } = await client.from('options')
    .select('id').eq('question_id', questionId).eq('option_letter', selectedOption).maybeSingle();
  if (!option) return { success: false, error: 'Selected option is not valid for this question.' };

  // 7. Duplicate check (application layer)
  const { data: existingResponse } = await client.from('responses')
    .select('id').eq('session_id', sessionId)
    .eq('participant_id', userId).eq('question_id', questionId).maybeSingle();
  if (existingResponse) return { success: false, error: 'Response already submitted.' };

  // 8. Insert
  const { error: insertError } = await client.from('responses').insert({
    session_id: sessionId, participant_id: userId,
    question_id: questionId, selected_option: selectedOption,
  });
  if (insertError) {
    if (insertError.code === '23505') return { success: false, error: 'Response already submitted.' };
    return { success: false, error: 'Failed to record your answer.' };
  }
  return { success: true };
}

// ─── Helper: transition session state ─────────────────────────────────────────
async function transitionSession(
  sessionId: string,
  targetStatus: string,
  questionId: number | null,
  fromStatus: string[]
): Promise<boolean> {
  const { error } = await svc.rpc('transition_session_status', {
    p_session_id: sessionId,
    p_target_status: targetStatus,
    p_question_id: questionId,
    p_expected_current_statuses: fromStatus,
  });
  return !error;
}

// ─── Cleanup helpers ──────────────────────────────────────────────────────────
const createdAuthIds: string[] = [];
const createdSessionIds: string[] = [];

async function cleanup() {
  console.log(`\n${B}CLEANUP${X}`);
  for (const sid of createdSessionIds) {
    await svc.from('activity_sessions').delete().eq('id', sid);
    console.log(`  Deleted session ${sid}`);
  }
  for (const uid of createdAuthIds) {
    await svc.auth.admin.deleteUser(uid);
    console.log(`  Deleted auth user ${uid}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${B}═══════════════════════════════════════════════════════════${X}`);
  console.log(`${B}  FYC STAGE 10.3C — QUESTION FLOW & RESPONSE INTEGRITY     ${X}`);
  console.log(`${B}═══════════════════════════════════════════════════════════${X}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 0. FETCH QUESTION IDs FROM DB (so we use the real database IDs)
  // ═══════════════════════════════════════════════════════════════════════════
  const { data: questions, error: qErr } = await svc
    .from('questions').select('id, question_number').order('question_number');
  if (qErr || !questions || questions.length !== 5) {
    console.error('Cannot load questions from staging DB:', qErr?.message);
    process.exit(1);
  }
  const Q = questions.reduce((acc, q) => { acc[q.question_number] = q.id; return acc; }, {} as Record<number,number>);
  console.log(`  Questions loaded: ${Object.entries(Q).map(([n,id]) => `Q${n}=id${id}`).join(', ')}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. CREATE TEST SESSION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`${B}1. CREATE TEST SESSION${X}`);
  const { data: sess, error: sessErr } = await svc
    .from('activity_sessions')
    .insert({ name: 'FYC-STAGE10-3C-QUESTIONS', status: 'LOBBY' })
    .select('id, status').single();
  if (sessErr || !sess) { console.error('Session creation failed:', sessErr?.message); process.exit(1); }
  createdSessionIds.push(sess.id);
  record('Session FYC-STAGE10-3C-QUESTIONS created', 'PASS', `id=${sess.id} status=${sess.status}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CREATE SYNTHETIC USER
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}2. CREATE TEST PARTICIPANT${X}`);
  const suffix = sess.id.substring(0, 8);
  const email = `fyc-10-3c-01-${suffix}@staging.test`;
  const { data: authData, error: authErr } = await svc.auth.admin.createUser({
    email, password: 'FycStaging10-3c!', email_confirm: true,
  });
  if (authErr) { console.error('Auth user creation failed:', authErr.message); process.exit(1); }
  const userId = authData.user.id;
  createdAuthIds.push(userId);
  record('Synthetic auth user created', 'PASS', `email redacted`);

  // Create participant profile + session registration via service role
  await svc.from('participants').upsert({
    id: userId, full_name: 'FYC Test Student 3C', email,
    phone: '9876543210', branch: 'Computer Science', year: 1, consent_status: true,
  });
  await svc.from('session_participants').insert({
    session_id: sess.id, participant_id: userId, status: 'REGISTERED',
  });
  record('Participant profile + session_participants created', 'PASS');

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. LOBBY PROTECTION — response submission must be rejected while LOBBY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}3. LOBBY PROTECTION${X}`);
  const lobbySubmit = await submitResponse(svc, userId, {
    sessionId: sess.id, questionId: Q[1], selectedOption: 'A',
  });
  record('Cannot submit response while session is LOBBY',
    !lobbySubmit.success && lobbySubmit.error?.includes('closed') ? 'PASS' : 'FAIL',
    lobbySubmit.error ?? 'unexpectedly accepted');
  const { data: lobbyRows } = await svc.from('responses')
    .select('id').eq('session_id', sess.id).eq('participant_id', userId);
  assertEq('No response rows in DB after lobby-protection test', lobbyRows?.length ?? 0, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. TRANSITION TO QUESTION_1
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}4. TRANSITION LOBBY → QUESTION_1${X}`);
  // Set timer_started_at and timer_duration via direct update (service-role admin action)
  const timerDuration = 60; // 60 seconds — enough to complete tests
  const timerStartedAt = new Date().toISOString();
  const ok1 = await transitionSession(sess.id, 'QUESTION_1', Q[1], ['LOBBY']);
  // Also set timer fields (transition_session_status may not set these)
  await svc.from('activity_sessions').update({
    timer_started_at: timerStartedAt,
    timer_duration: timerDuration,
  }).eq('id', sess.id);
  record('Transition LOBBY → QUESTION_1', ok1 ? 'PASS' : 'FAIL');

  const { data: q1Sess } = await svc.from('activity_sessions')
    .select('status, current_question_id, timer_started_at, timer_duration').eq('id', sess.id).single();
  assertEq('Session status = QUESTION_1', q1Sess?.status, 'QUESTION_1');
  assertEq('current_question_id = Q1 id', q1Sess?.current_question_id, Q[1]);
  record('timer_started_at set', q1Sess?.timer_started_at ? 'PASS' : 'FAIL',
    q1Sess?.timer_started_at ? 'timestamp present' : 'NULL');
  record('timer_duration set', q1Sess?.timer_duration === timerDuration ? 'PASS' : 'FAIL',
    `value=${q1Sess?.timer_duration}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. QUESTION ACCESS CONTROL — cannot submit future questions while Q1 active
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}5. QUESTION ACCESS CONTROL${X}`);
  for (const futureQ of [2, 3, 4, 5]) {
    const res = await submitResponse(svc, userId, {
      sessionId: sess.id, questionId: Q[futureQ], selectedOption: 'A',
    });
    record(`Q${futureQ} submission rejected while Q1 is active`,
      !res.success && res.error?.includes('does not match') ? 'PASS' : 'FAIL',
      res.error ?? 'unexpectedly accepted');
  }
  // Verify no spurious rows created
  const { data: noFutureRows } = await svc.from('responses')
    .select('id').eq('session_id', sess.id).eq('participant_id', userId);
  assertEq('No response rows after future-question access control test', noFutureRows?.length ?? 0, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. SUBMIT Q1 — valid response
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}6. SUBMIT Q1 (valid)${X}`);
  const q1Submit = await submitResponse(svc, userId, {
    sessionId: sess.id, questionId: Q[1], selectedOption: 'A',
  });
  record('Q1 submission accepted', q1Submit.success ? 'PASS' : 'FAIL', q1Submit.error ?? 'ok');

  // Verify DB record
  const { data: q1Row } = await svc.from('responses')
    .select('*').eq('session_id', sess.id)
    .eq('participant_id', userId).eq('question_id', Q[1]).single();
  record('Q1 response row exists in DB', q1Row ? 'PASS' : 'FAIL');
  assertEq('Q1 response: correct session_id', q1Row?.session_id, sess.id);
  assertEq('Q1 response: correct participant_id', q1Row?.participant_id, userId);
  assertEq('Q1 response: correct question_id', q1Row?.question_id, Q[1]);
  assertEq('Q1 response: selected_option = A', q1Row?.selected_option, 'A');
  record('Q1 response: submitted_at present', q1Row?.submitted_at ? 'PASS' : 'FAIL',
    q1Row?.submitted_at ?? 'NULL');

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. DUPLICATE Q1 — must be rejected, exactly 1 row must remain
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}7. DUPLICATE Q1 SUBMISSION${X}`);
  const q1Dup = await submitResponse(svc, userId, {
    sessionId: sess.id, questionId: Q[1], selectedOption: 'B',
  });
  record('Duplicate Q1 submission rejected',
    !q1Dup.success && q1Dup.error?.includes('already submitted') ? 'PASS' : 'FAIL',
    q1Dup.error ?? 'unexpectedly accepted');

  // Verify exactly 1 Q1 response row in DB (UNIQUE constraint test)
  const { data: q1DupRows } = await svc.from('responses')
    .select('id, selected_option').eq('session_id', sess.id)
    .eq('participant_id', userId).eq('question_id', Q[1]);
  assertEq('UNIQUE constraint: exactly 1 Q1 response row', q1DupRows?.length ?? 0, 1);
  assertEq('Original Q1 answer (A) unchanged', q1DupRows?.[0]?.selected_option, 'A');

  // Also verify DB-level constraint by attempting direct insert (bypassing app check)
  const { error: uniqueErr } = await svc.from('responses').insert({
    session_id: sess.id, participant_id: userId,
    question_id: Q[1], selected_option: 'C',
  });
  record('UNIQUE(session_id, participant_id, question_id) enforced at DB level',
    uniqueErr?.code === '23505' ? 'PASS' : 'FAIL',
    uniqueErr ? `code=${uniqueErr.code}` : 'NO ERROR — constraint not enforced!');

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. INVALID OPTION TEST — option 'E' does not exist
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}8. INVALID OPTION TEST${X}`);
  const invalidOpt = await submitResponse(svc, userId, {
    sessionId: sess.id, questionId: Q[1], selectedOption: 'E' as any,
  });
  record('Option E rejected (not a valid option)',
    !invalidOpt.success && invalidOpt.error?.includes('not valid') ? 'PASS' : 'FAIL',
    invalidOpt.error ?? 'unexpectedly accepted');
  const { data: afterInvalidRows } = await svc.from('responses')
    .select('id').eq('session_id', sess.id).eq('participant_id', userId);
  assertEq('DB unchanged after invalid option attempt', afterInvalidRows?.length ?? 0, 1);

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. WRONG QUESTION ID TEST — Q2 while Q1 active
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}9. WRONG QUESTION ID TEST${X}`);
  const wrongQ = await submitResponse(svc, userId, {
    sessionId: sess.id, questionId: Q[2], selectedOption: 'B',
  });
  record('Q2 submission rejected while Q1 active (wrong question id)',
    !wrongQ.success && wrongQ.error?.includes('does not match') ? 'PASS' : 'FAIL',
    wrongQ.error ?? 'unexpectedly accepted');
  const { data: afterWrongRows } = await svc.from('responses')
    .select('id').eq('session_id', sess.id).eq('participant_id', userId).eq('question_id', Q[2]);
  assertEq('No Q2 response row created during wrong-question test', afterWrongRows?.length ?? 0, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. TIMER TEST — expired timer rejection
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}10. TIMER ENFORCEMENT TEST${X}`);

  // 10A. Before expiry — already demonstrated by Q1 successful submit above
  record('Before-expiry submission accepted', q1Submit.success ? 'PASS' : 'FAIL',
    'Confirmed by Q1 successful submit in §6');

  // 10B. After expiry — set timer to expired in the past (service-role admin action)
  // Create a SECOND test session for the timer-expiry test so we don't disturb main flow
  const { data: timerSess } = await svc.from('activity_sessions')
    .insert({ name: 'FYC-STAGE10-3C-TIMER-PROBE', status: 'LOBBY' })
    .select('id').single();
  if (timerSess) {
    createdSessionIds.push(timerSess.id);
    // Register the same user in this session
    await svc.from('session_participants').insert({
      session_id: timerSess.id, participant_id: userId, status: 'REGISTERED',
    });
    // Transition to Q1 with timer already expired (started 5 minutes ago, duration 1s)
    await transitionSession(timerSess.id, 'QUESTION_1', Q[1], ['LOBBY']);
    const expiredStart = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    await svc.from('activity_sessions').update({
      timer_started_at: expiredStart,
      timer_duration: 1, // 1 second — expired 5 minutes ago
    }).eq('id', timerSess.id);

    const expiredSubmit = await submitResponse(svc, userId, {
      sessionId: timerSess.id, questionId: Q[1], selectedOption: 'A',
    });
    record("After-expiry submission rejected (server-side timer is authoritative)",
      !expiredSubmit.success && expiredSubmit.error?.includes("Time's up") ? 'PASS' : 'FAIL',
      expiredSubmit.error ?? 'unexpectedly accepted — timer not enforced server-side!');

    // Verify no row was created in the expired session
    const { data: expiredRows } = await svc.from('responses')
      .select('id').eq('session_id', timerSess.id).eq('participant_id', userId);
    assertEq('No response row after expired-timer submission', expiredRows?.length ?? 0, 0);
  } else {
    record('Timer probe session created', 'FAIL', 'Could not create session for timer test');
    record("After-expiry submission rejected (server-side timer is authoritative)", 'NOT EXECUTED');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. QUESTION 2 — transition + submit
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}11. QUESTION 2${X}`);
  // Reset timer for the main session before each transition
  const timerStart2 = new Date().toISOString();
  const ok2 = await transitionSession(sess.id, 'QUESTION_2', Q[2], ['QUESTION_1']);
  await svc.from('activity_sessions').update({ timer_started_at: timerStart2, timer_duration: 60 }).eq('id', sess.id);
  record('Transition QUESTION_1 → QUESTION_2', ok2 ? 'PASS' : 'FAIL');

  // Verify Q1 cannot be re-answered
  const q1Late = await submitResponse(svc, userId, { sessionId: sess.id, questionId: Q[1], selectedOption: 'D' });
  record('Q1 cannot be re-answered after Q2 is active',
    !q1Late.success ? 'PASS' : 'FAIL', q1Late.error ?? 'unexpectedly accepted');

  // Submit Q2
  const q2Submit = await submitResponse(svc, userId, { sessionId: sess.id, questionId: Q[2], selectedOption: 'B' });
  record('Q2 submission accepted', q2Submit.success ? 'PASS' : 'FAIL', q2Submit.error ?? 'ok');
  const { data: q2Row } = await svc.from('responses')
    .select('selected_option').eq('session_id', sess.id)
    .eq('participant_id', userId).eq('question_id', Q[2]).single();
  assertEq('Q2 response: selected_option = B', q2Row?.selected_option, 'B');

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. QUESTION 3
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}12. QUESTION 3${X}`);
  const timerStart3 = new Date().toISOString();
  const ok3 = await transitionSession(sess.id, 'QUESTION_3', Q[3], ['QUESTION_2']);
  await svc.from('activity_sessions').update({ timer_started_at: timerStart3, timer_duration: 60 }).eq('id', sess.id);
  record('Transition QUESTION_2 → QUESTION_3', ok3 ? 'PASS' : 'FAIL');
  const q3Submit = await submitResponse(svc, userId, { sessionId: sess.id, questionId: Q[3], selectedOption: 'C' });
  record('Q3 submission accepted', q3Submit.success ? 'PASS' : 'FAIL', q3Submit.error ?? 'ok');
  const { data: q3Row } = await svc.from('responses')
    .select('selected_option').eq('session_id', sess.id)
    .eq('participant_id', userId).eq('question_id', Q[3]).single();
  assertEq('Q3 response: selected_option = C', q3Row?.selected_option, 'C');

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. QUESTION 4
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}13. QUESTION 4${X}`);
  const timerStart4 = new Date().toISOString();
  const ok4 = await transitionSession(sess.id, 'QUESTION_4', Q[4], ['QUESTION_3']);
  await svc.from('activity_sessions').update({ timer_started_at: timerStart4, timer_duration: 60 }).eq('id', sess.id);
  record('Transition QUESTION_3 → QUESTION_4', ok4 ? 'PASS' : 'FAIL');
  const q4Submit = await submitResponse(svc, userId, { sessionId: sess.id, questionId: Q[4], selectedOption: 'D' });
  record('Q4 submission accepted', q4Submit.success ? 'PASS' : 'FAIL', q4Submit.error ?? 'ok');
  const { data: q4Row } = await svc.from('responses')
    .select('selected_option').eq('session_id', sess.id)
    .eq('participant_id', userId).eq('question_id', Q[4]).single();
  assertEq('Q4 response: selected_option = D', q4Row?.selected_option, 'D');

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. QUESTION 5
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}14. QUESTION 5${X}`);
  const timerStart5 = new Date().toISOString();
  const ok5 = await transitionSession(sess.id, 'QUESTION_5', Q[5], ['QUESTION_4']);
  await svc.from('activity_sessions').update({ timer_started_at: timerStart5, timer_duration: 60 }).eq('id', sess.id);
  record('Transition QUESTION_4 → QUESTION_5', ok5 ? 'PASS' : 'FAIL');
  const q5Submit = await submitResponse(svc, userId, { sessionId: sess.id, questionId: Q[5], selectedOption: 'A' });
  record('Q5 submission accepted', q5Submit.success ? 'PASS' : 'FAIL', q5Submit.error ?? 'ok');
  const { data: q5Row } = await svc.from('responses')
    .select('selected_option').eq('session_id', sess.id)
    .eq('participant_id', userId).eq('question_id', Q[5]).single();
  assertEq('Q5 response: selected_option = A', q5Row?.selected_option, 'A');

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. FINAL RESPONSE COUNT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}15. FINAL RESPONSE COUNT${X}`);
  const { data: allResponses } = await svc.from('responses')
    .select('question_id, selected_option')
    .eq('session_id', sess.id).eq('participant_id', userId);
  assertEq('Total responses for participant = 5', allResponses?.length ?? 0, 5);
  for (let qn = 1; qn <= 5; qn++) {
    const rows = allResponses?.filter(r => r.question_id === Q[qn]) ?? [];
    assertEq(`Exactly 1 response for Q${qn}`, rows.length, 1);
  }
  console.log(`  Response vector: ${allResponses?.sort((a,b) => a.question_id - b.question_id).map(r => r.selected_option).join('')}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 16. RESPONSE IMMUTABILITY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}16. RESPONSE IMMUTABILITY${X}`);
  const { data: firstResp } = await svc.from('responses')
    .select('id, selected_option').eq('session_id', sess.id)
    .eq('participant_id', userId).eq('question_id', Q[1]).single();

  // Attempt UPDATE via anon client (no auth = no RLS permission)
  const { error: updateErr } = await anon.from('responses')
    .update({ selected_option: 'D' }).eq('id', firstResp?.id ?? '');
  record('Anon cannot UPDATE a response row',
    !!updateErr ? 'PASS' : 'FAIL',
    updateErr ? `blocked: ${updateErr.code}` : 'UNEXPECTEDLY ALLOWED');

  // Attempt DELETE via anon client
  const { error: deleteErr } = await anon.from('responses')
    .delete().eq('id', firstResp?.id ?? '');
  record('Anon cannot DELETE a response row',
    !!deleteErr ? 'PASS' : 'FAIL',
    deleteErr ? `blocked: ${deleteErr.code}` : 'UNEXPECTEDLY ALLOWED');

  // Verify original response untouched
  const { data: afterMutRow } = await svc.from('responses')
    .select('selected_option').eq('id', firstResp?.id ?? '').single();
  assertEq('Original Q1 response remains A after immutability test', afterMutRow?.selected_option, 'A');

  // ═══════════════════════════════════════════════════════════════════════════
  // 17. CROSS-SESSION RESPONSE ISOLATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}17. CROSS-SESSION RESPONSE ISOLATION${X}`);
  const { data: crossSess } = await svc.from('activity_sessions')
    .insert({ name: 'FYC-STAGE10-3C-CROSS-SESSION', status: 'LOBBY' })
    .select('id').single();
  if (crossSess) {
    createdSessionIds.push(crossSess.id);
    // Do NOT register user in this session — attempt response directly
    const crossResp = await submitResponse(svc, userId, {
      sessionId: crossSess.id, questionId: Q[1], selectedOption: 'A',
    });
    record('Response in non-registered session rejected',
      !crossResp.success && crossResp.error?.includes('not registered') ? 'PASS' : 'FAIL',
      crossResp.error ?? 'unexpectedly accepted');

    // Attempt direct DB insert with wrong session_id
    const { error: crossInsertErr } = await anon.from('responses').insert({
      session_id: crossSess.id, participant_id: userId,
      question_id: Q[1], selected_option: 'A',
    });
    record('Anon cannot insert cross-session response directly',
      !!crossInsertErr ? 'PASS' : 'FAIL',
      crossInsertErr ? `blocked: ${crossInsertErr.code}` : 'UNEXPECTEDLY ALLOWED');

    // Verify no cross-session responses
    const { data: crossRows } = await svc.from('responses')
      .select('id').eq('session_id', crossSess.id).eq('participant_id', userId);
    assertEq('No cross-session response rows in DB', crossRows?.length ?? 0, 0);
  } else {
    record('Cross-session isolation test', 'NOT EXECUTED', 'Could not create cross-session');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 18. REFRESH/REJOIN TEST — DB is source of truth
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}18. REFRESH / REJOIN TEST${X}`);
  // Simulate a page refresh by re-querying session state and responses from scratch
  const { data: refreshSess } = await svc.from('activity_sessions')
    .select('status, current_question_id').eq('id', sess.id).single();
  record('Session state reconstructed from DB after refresh',
    refreshSess?.status === 'QUESTION_5' ? 'PASS' : 'FAIL',
    `status=${refreshSess?.status} current_question_id=${refreshSess?.current_question_id}`);

  const { data: refreshResponses } = await svc.from('responses')
    .select('question_id, selected_option')
    .eq('session_id', sess.id).eq('participant_id', userId);
  record('All 5 responses retrievable after refresh',
    (refreshResponses?.length ?? 0) === 5 ? 'PASS' : 'FAIL',
    `count=${refreshResponses?.length ?? 0}`);

  // Attempt to re-submit Q5 (currently active) — must be rejected as duplicate
  const refreshDup = await submitResponse(svc, userId, {
    sessionId: sess.id, questionId: Q[5], selectedOption: 'B',
  });
  record('Cannot re-submit Q5 after simulated refresh (idempotency guard)',
    !refreshDup.success && refreshDup.error?.includes('already submitted') ? 'PASS' : 'FAIL',
    refreshDup.error ?? 'unexpectedly accepted');

  // ═══════════════════════════════════════════════════════════════════════════
  // 19. PROJECTOR SYNCHRONIZATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}19. PROJECTOR SYNCHRONIZATION${X}`);
  // The projector reads activity_sessions directly. Verify it can query the current state.
  const { data: projState, error: projErr } = await svc
    .from('activity_sessions')
    .select('id, status, current_question_id, timer_started_at, timer_duration')
    .eq('id', sess.id).single();
  record('Projector route can read session state from DB',
    !projErr && projState ? 'PASS' : 'FAIL',
    projState ? `status=${projState.status} q=${projState.current_question_id}` : projErr?.message);

  // Verify the projector can also reconstruct after a refresh (stateless read)
  const { data: projRefresh } = await svc.from('activity_sessions')
    .select('status').eq('id', sess.id).single();
  record('Projector reconstructs authoritative state after simulated refresh',
    projRefresh?.status === 'QUESTION_5' ? 'PASS' : 'FAIL',
    `reconstructed status=${projRefresh?.status}`);
  record('Projector runtime browser test', 'NOT EXECUTED',
    'Requires live browser session — deferred to manual / E2E browser test stage');

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════
  await cleanup();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}═══════════════════════════════════════════════════════════${X}`);
  const keys   = Object.keys(results);
  const passed = keys.filter(k => results[k].status === 'PASS').length;
  const failed = keys.filter(k => results[k].status === 'FAIL').length;
  const notEx  = keys.filter(k => results[k].status === 'NOT EXECUTED').length;
  const failedKeys = keys.filter(k => results[k].status === 'FAIL');
  console.log(`  ${G}PASS${X}: ${passed}   ${R}FAIL${X}: ${failed}   ${Y}NOT EXECUTED${X}: ${notEx}`);
  if (failedKeys.length) {
    console.log(`\n  ${R}Failed checks:${X}`);
    failedKeys.forEach(k => console.log(`    • ${k}: ${results[k].note}`));
  }
  console.log(`${B}═══════════════════════════════════════════════════════════${X}\n`);

  return results;
}

main().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
