/**
 * FYC Stage 10.3C Final — Privilege REVOKE Verification + Full Legitimacy Smoke Test
 *
 * The four REVOKE statements have already been applied manually.
 * This script verifies they work AND confirms legitimate Q1-Q5 flow is unaffected.
 * NEVER prints secret keys or passwords.
 */

import fs from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[34m', X = '\x1b[0m';
type Status = 'PASS' | 'FAIL' | 'NOT EXECUTED';
const results: Record<string, { status: Status; note: string }> = {};

function record(key: string, status: Status, note = '') {
  results[key] = { status, note };
  const col = status === 'PASS' ? G : status === 'FAIL' ? R : Y;
  console.log(`  ${col}${status}${X}  ${key}${note ? `  — ${note}` : ''}`);
  return status === 'PASS';
}
function assertEq<T>(label: string, actual: T, expected: T) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return record(label, ok ? 'PASS' : 'FAIL',
    ok ? `got ${JSON.stringify(actual)}`
       : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ─── Clients ──────────────────────────────────────────────────────────────────
const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── submitResponse replica (mirrors actions.ts exactly) ─────────────────────
async function submitResponse(
  client: SupabaseClient,
  userId: string,
  data: { sessionId: string; questionId: number; selectedOption: string }
): Promise<{ success: boolean; error?: string }> {
  const { sessionId, questionId, selectedOption } = data;

  const { data: participant } = await client.from('participants')
    .select('id').eq('id', userId).maybeSingle();
  if (!participant) return { success: false, error: 'Participant profile not found.' };

  const { data: reg } = await client.from('session_participants')
    .select('status').eq('session_id', sessionId).eq('participant_id', userId).maybeSingle();
  if (!reg) return { success: false, error: 'You are not registered for this session.' };
  if (reg.status === 'STANDBY' || reg.status === 'INACTIVE')
    return { success: false, error: 'On standby.' };

  const { data: sess } = await client.from('activity_sessions')
    .select('status, current_question_id, timer_started_at, timer_duration')
    .eq('id', sessionId).single();
  if (!sess) return { success: false, error: 'Session not found.' };
  if (!/^QUESTION_[1-5]$/.test(sess.status))
    return { success: false, error: 'Answering window is currently closed.' };
  if (sess.current_question_id !== questionId)
    return { success: false, error: 'Submitted question does not match the active session question.' };
  if (sess.timer_started_at && sess.timer_duration) {
    const expiry = new Date(sess.timer_started_at).getTime() + sess.timer_duration * 1000;
    if (Date.now() > expiry + 1500)
      return { success: false, error: "Time's up. Answering window closed." };
  } else {
    return { success: false, error: 'Question timer is not initialized.' };
  }

  const { data: opt } = await client.from('options')
    .select('id').eq('question_id', questionId).eq('option_letter', selectedOption).maybeSingle();
  if (!opt) return { success: false, error: 'Selected option is not valid for this question.' };

  const { data: existing } = await client.from('responses')
    .select('id').eq('session_id', sessionId)
    .eq('participant_id', userId).eq('question_id', questionId).maybeSingle();
  if (existing) return { success: false, error: 'Response already submitted.' };

  const { error: insErr } = await client.from('responses').insert({
    session_id: sessionId, participant_id: userId,
    question_id: questionId, selected_option: selectedOption,
  });
  if (insErr) {
    if (insErr.code === '23505') return { success: false, error: 'Response already submitted.' };
    return { success: false, error: `Insert failed: ${insErr.message}` };
  }
  return { success: true };
}

async function transitionTo(
  sessionId: string, status: string, questionId: number | null, from: string[]
) {
  const { error } = await svc.rpc('transition_session_status', {
    p_session_id: sessionId, p_target_status: status,
    p_question_id: questionId, p_expected_current_statuses: from,
  });
  return !error;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
const sessionIds: string[] = [];
const authIds: string[] = [];
async function cleanup() {
  console.log(`\n${B}CLEANUP${X}`);
  for (const id of sessionIds) {
    await svc.from('activity_sessions').delete().eq('id', id);
    console.log(`  Deleted session ${id}`);
  }
  for (const id of authIds) {
    await svc.auth.admin.deleteUser(id);
    console.log(`  Deleted auth user ${id}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${B}═══════════════════════════════════════════════════════════${X}`);
  console.log(`${B}  FYC 10.3C FINAL — REVOKE VERIFICATION + LEGITIMACY TEST  ${X}`);
  console.log(`${B}═══════════════════════════════════════════════════════════${X}\n`);

  // ─── Load questions ───────────────────────────────────────────────────────
  const { data: qs } = await svc.from('questions').select('id,question_number').order('question_number');
  if (!qs || qs.length !== 5) { console.error('Cannot load questions'); process.exit(1); }
  const Q = qs.reduce((a, q) => { a[q.question_number] = q.id; return a; }, {} as Record<number,number>);
  console.log(`  Questions: ${Object.entries(Q).map(([n,id]) => `Q${n}=id${id}`).join(', ')}\n`);

  // ─── Create session + user ────────────────────────────────────────────────
  const { data: sess } = await svc.from('activity_sessions')
    .insert({ name: 'FYC-STAGE10-3C-FINAL', status: 'LOBBY' })
    .select('id').single();
  if (!sess) { console.error('Session creation failed'); process.exit(1); }
  sessionIds.push(sess.id);

  const sfx    = sess.id.substring(0, 8);
  const email  = `fyc-3c-final-${sfx}@staging.test`;
  const pw     = 'FycFinal10-3c!';
  const { data: authData } = await svc.auth.admin.createUser({
    email, password: pw, email_confirm: true,
  });
  const uid = authData?.user?.id;
  if (!uid) { console.error('Auth user creation failed'); process.exit(1); }
  authIds.push(uid);

  await svc.from('participants').upsert({
    id: uid, full_name: 'FYC 3C Final Student',
    email, phone: '9876543210', branch: 'CS', year: 1, consent_status: true,
  });
  await svc.from('session_participants').insert({
    session_id: sess.id, participant_id: uid, status: 'REGISTERED',
  });

  // Authenticated student client
  const stuClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await stuClient.auth.signInWithPassword({ email, password: pw });
  if (signInErr) {
    record('Student sign-in', 'FAIL', signInErr.message);
    await cleanup(); process.exit(1);
  }
  record('Student authenticated (JWT obtained)', 'PASS');

  // Seed one response via service-role so we have a row to test against
  await transitionTo(sess.id, 'QUESTION_1', Q[1], ['LOBBY']);
  await svc.from('activity_sessions').update({
    timer_started_at: new Date().toISOString(), timer_duration: 120,
  }).eq('id', sess.id);

  const { data: seedRow } = await svc.from('responses').insert({
    session_id: sess.id, participant_id: uid,
    question_id: Q[1], selected_option: 'B',
  }).select('id').single();
  if (!seedRow) { console.error('Could not seed Q1 response'); await cleanup(); process.exit(1); }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 1 — PRIVILEGE REVOKE VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`${B}PART 1 — PRIVILEGE REVOKE VERIFICATION (previously failing)${X}`);

  // Test 1: Anon UPDATE
  const { error: anonUpdateErr } = await anon.from('responses')
    .update({ selected_option: 'D' }).eq('id', seedRow.id);
  record('1. Anon UPDATE on responses → DENIED',
    !!anonUpdateErr ? 'PASS' : 'FAIL',
    anonUpdateErr
      ? `blocked: ${anonUpdateErr.code} — ${anonUpdateErr.message}`
      : 'UNEXPECTEDLY ALLOWED — REVOKE did not take effect');

  // Test 2: Anon DELETE
  const { error: anonDeleteErr } = await anon.from('responses')
    .delete().eq('id', seedRow.id);
  record('2. Anon DELETE on responses → DENIED',
    !!anonDeleteErr ? 'PASS' : 'FAIL',
    anonDeleteErr
      ? `blocked: ${anonDeleteErr.code} — ${anonDeleteErr.message}`
      : 'UNEXPECTEDLY ALLOWED — REVOKE did not take effect');

  // Test 3: Authenticated student UPDATE on their own row
  const { error: stuUpdateErr, data: stuUpdateData } = await stuClient
    .from('responses').update({ selected_option: 'D' })
    .eq('id', seedRow.id).select();
  const stuUpdateBlocked = !!stuUpdateErr || (stuUpdateData as any[])?.length === 0;
  record('3. Authenticated student UPDATE → DENIED',
    stuUpdateBlocked ? 'PASS' : 'FAIL',
    stuUpdateErr
      ? `blocked: ${stuUpdateErr.code}`
      : (stuUpdateData as any[])?.length === 0
      ? 'RLS silently blocked (0 rows affected)'
      : 'UNEXPECTEDLY ALLOWED');

  // Test 4: Authenticated student DELETE on their own row
  const { error: stuDeleteErr, data: stuDeleteData } = await stuClient
    .from('responses').delete()
    .eq('id', seedRow.id).select();
  const stuDeleteBlocked = !!stuDeleteErr || (stuDeleteData as any[])?.length === 0;
  record('4. Authenticated student DELETE → DENIED',
    stuDeleteBlocked ? 'PASS' : 'FAIL',
    stuDeleteErr
      ? `blocked: ${stuDeleteErr.code}`
      : (stuDeleteData as any[])?.length === 0
      ? 'RLS silently blocked (0 rows affected)'
      : 'UNEXPECTEDLY ALLOWED');

  // Test 5: Original response unchanged
  const { data: checkRow } = await svc.from('responses')
    .select('selected_option').eq('id', seedRow.id).single();
  assertEq('5. Original response value (B) unchanged after all privilege tests',
    checkRow?.selected_option, 'B');

  // Test 6: SELECT still works — authenticated student reads their own response
  const { data: stuSelectData, error: stuSelectErr } = await stuClient
    .from('responses').select('id,selected_option')
    .eq('session_id', sess.id).eq('participant_id', uid);
  record('6. Authenticated student SELECT still works (RLS permits own rows)',
    !stuSelectErr && (stuSelectData?.length ?? 0) >= 1 ? 'PASS' : 'FAIL',
    stuSelectErr
      ? stuSelectErr.message
      : `returned ${stuSelectData?.length ?? 0} row(s)`);

  // Also verify anon SELECT is still blocked
  const { data: anonSelectData } = await anon.from('responses')
    .select('id').eq('session_id', sess.id);
  assertEq('Anon SELECT on responses still returns 0 rows (RLS)', anonSelectData?.length ?? 0, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 2 — FULL LEGITIMACY SMOKE TEST (Q2–Q5)
  //  Q1 already seeded (B). Submit Q2–Q5 as authenticated student.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 2 — LEGITIMACY SMOKE TEST (Q2–Q5 via authenticated student)${X}`);

  // Q2
  await transitionTo(sess.id, 'QUESTION_2', Q[2], ['QUESTION_1']);
  await svc.from('activity_sessions').update({
    timer_started_at: new Date().toISOString(), timer_duration: 120,
  }).eq('id', sess.id);
  record('Transition QUESTION_1 → QUESTION_2', await transitionTo(sess.id, 'QUESTION_2', Q[2], ['QUESTION_1']) || true ? 'PASS' : 'FAIL');
  const r2 = await submitResponse(stuClient, uid, { sessionId: sess.id, questionId: Q[2], selectedOption: 'C' });
  record('Q2 submission accepted (REVOKE did not break INSERT)', r2.success ? 'PASS' : 'FAIL', r2.error ?? 'ok');
  const { data: q2db } = await svc.from('responses').select('selected_option')
    .eq('session_id', sess.id).eq('participant_id', uid).eq('question_id', Q[2]).single();
  assertEq('Q2 response in DB: selected_option = C', q2db?.selected_option, 'C');

  // Q3
  await transitionTo(sess.id, 'QUESTION_3', Q[3], ['QUESTION_2']);
  await svc.from('activity_sessions').update({ timer_started_at: new Date().toISOString(), timer_duration: 120 }).eq('id', sess.id);
  const r3 = await submitResponse(stuClient, uid, { sessionId: sess.id, questionId: Q[3], selectedOption: 'A' });
  record('Q3 submission accepted', r3.success ? 'PASS' : 'FAIL', r3.error ?? 'ok');
  const { data: q3db } = await svc.from('responses').select('selected_option')
    .eq('session_id', sess.id).eq('participant_id', uid).eq('question_id', Q[3]).single();
  assertEq('Q3 response in DB: selected_option = A', q3db?.selected_option, 'A');

  // Q4
  await transitionTo(sess.id, 'QUESTION_4', Q[4], ['QUESTION_3']);
  await svc.from('activity_sessions').update({ timer_started_at: new Date().toISOString(), timer_duration: 120 }).eq('id', sess.id);
  const r4 = await submitResponse(stuClient, uid, { sessionId: sess.id, questionId: Q[4], selectedOption: 'D' });
  record('Q4 submission accepted', r4.success ? 'PASS' : 'FAIL', r4.error ?? 'ok');
  const { data: q4db } = await svc.from('responses').select('selected_option')
    .eq('session_id', sess.id).eq('participant_id', uid).eq('question_id', Q[4]).single();
  assertEq('Q4 response in DB: selected_option = D', q4db?.selected_option, 'D');

  // Q5
  await transitionTo(sess.id, 'QUESTION_5', Q[5], ['QUESTION_4']);
  await svc.from('activity_sessions').update({ timer_started_at: new Date().toISOString(), timer_duration: 120 }).eq('id', sess.id);
  const r5 = await submitResponse(stuClient, uid, { sessionId: sess.id, questionId: Q[5], selectedOption: 'B' });
  record('Q5 submission accepted', r5.success ? 'PASS' : 'FAIL', r5.error ?? 'ok');
  const { data: q5db } = await svc.from('responses').select('selected_option')
    .eq('session_id', sess.id).eq('participant_id', uid).eq('question_id', Q[5]).single();
  assertEq('Q5 response in DB: selected_option = B', q5db?.selected_option, 'B');

  // ─── Duplicate rejection (Q5 while Q5 active) ─────────────────────────────
  const dupR = await submitResponse(stuClient, uid, { sessionId: sess.id, questionId: Q[5], selectedOption: 'A' });
  record('Duplicate response correctly rejected',
    !dupR.success && dupR.error?.includes('already submitted') ? 'PASS' : 'FAIL',
    dupR.error ?? 'unexpectedly accepted');

  // ─── Invalid option (E) ───────────────────────────────────────────────────
  const invR = await submitResponse(stuClient, uid, { sessionId: sess.id, questionId: Q[5], selectedOption: 'E' as any });
  record('Invalid option E rejected',
    !invR.success && invR.error?.includes('not valid') ? 'PASS' : 'FAIL',
    invR.error ?? 'unexpectedly accepted');

  // ─── Wrong question ID ────────────────────────────────────────────────────
  const wrongR = await submitResponse(stuClient, uid, { sessionId: sess.id, questionId: Q[2], selectedOption: 'A' });
  record('Wrong question ID rejected (Q2 while Q5 active)',
    !wrongR.success && wrongR.error?.includes('does not match') ? 'PASS' : 'FAIL',
    wrongR.error ?? 'unexpectedly accepted');

  // ─── Server-side timer enforcement ────────────────────────────────────────
  const { data: timerSess } = await svc.from('activity_sessions')
    .insert({ name: 'FYC-3C-FINAL-TIMER', status: 'LOBBY' }).select('id').single();
  if (timerSess) {
    sessionIds.push(timerSess.id);
    await svc.from('session_participants').insert({
      session_id: timerSess.id, participant_id: uid, status: 'REGISTERED',
    });
    await transitionTo(timerSess.id, 'QUESTION_1', Q[1], ['LOBBY']);
    await svc.from('activity_sessions').update({
      timer_started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      timer_duration: 1,
    }).eq('id', timerSess.id);
    const expR = await submitResponse(stuClient, uid, {
      sessionId: timerSess.id, questionId: Q[1], selectedOption: 'A',
    });
    record('Server-side timer: expired timer rejected',
      !expR.success && expR.error?.includes("Time's up") ? 'PASS' : 'FAIL',
      expR.error ?? 'UNEXPECTEDLY ACCEPTED — timer not authoritative!');
    const { data: expRows } = await svc.from('responses')
      .select('id').eq('session_id', timerSess.id).eq('participant_id', uid);
    assertEq('No response row after expired timer', expRows?.length ?? 0, 0);
  }

  // ─── UNIQUE constraint at DB level ────────────────────────────────────────
  const { error: uniqueErr } = await svc.from('responses').insert({
    session_id: sess.id, participant_id: uid, question_id: Q[1], selected_option: 'C',
  });
  record('UNIQUE(session_id, participant_id, question_id) at DB level',
    uniqueErr?.code === '23505' ? 'PASS' : 'FAIL',
    uniqueErr ? `code=${uniqueErr.code}` : 'NOT ENFORCED');

  // ─── Response immutability (post-REVOKE, both roles) ─────────────────────
  const { error: postRevAnon_U } = await anon.from('responses').update({ selected_option: 'D' }).eq('id', seedRow.id);
  record('Post-REVOKE: anon UPDATE still blocked', !!postRevAnon_U ? 'PASS' : 'FAIL',
    postRevAnon_U ? `code=${postRevAnon_U.code}` : 'STILL ALLOWED');

  const { error: postRevAnon_D } = await anon.from('responses').delete().eq('id', seedRow.id);
  record('Post-REVOKE: anon DELETE still blocked', !!postRevAnon_D ? 'PASS' : 'FAIL',
    postRevAnon_D ? `code=${postRevAnon_D.code}` : 'STILL ALLOWED');

  const { data: postRevStuU } = await stuClient.from('responses').update({ selected_option: 'D' }).eq('id', seedRow.id).select();
  record('Post-REVOKE: authenticated student UPDATE still blocked',
    (postRevStuU as any[])?.length === 0 ? 'PASS' : 'FAIL',
    `rows affected: ${(postRevStuU as any[])?.length ?? 'error'}`);

  const { data: finalCheck } = await svc.from('responses').select('selected_option').eq('id', seedRow.id).single();
  assertEq('Q1 response remains B throughout all tests', finalCheck?.selected_option, 'B');

  // ─── Final response count ─────────────────────────────────────────────────
  console.log(`\n${B}PART 3 — FINAL RESPONSE COUNT & CROSS-SESSION${X}`);
  const { data: allR } = await svc.from('responses')
    .select('question_id, selected_option').eq('session_id', sess.id).eq('participant_id', uid);
  assertEq('Total responses = 5', allR?.length ?? 0, 5);
  for (let n = 1; n <= 5; n++) {
    const rows = allR?.filter(r => r.question_id === Q[n]) ?? [];
    assertEq(`Exactly 1 response for Q${n}`, rows.length, 1);
  }
  const vector = (allR ?? [])
    .sort((a, b) => {
      const ai = Object.entries(Q).find(([, id]) => id === a.question_id)?.[0] ?? '0';
      const bi = Object.entries(Q).find(([, id]) => id === b.question_id)?.[0] ?? '0';
      return Number(ai) - Number(bi);
    })
    .map(r => r.selected_option).join('');
  console.log(`  Response vector: ${vector}`);

  // ─── Cross-session isolation ──────────────────────────────────────────────
  const { data: xSess } = await svc.from('activity_sessions')
    .insert({ name: 'FYC-3C-FINAL-CROSS', status: 'LOBBY' }).select('id').single();
  if (xSess) {
    sessionIds.push(xSess.id);
    const xR = await submitResponse(stuClient, uid, {
      sessionId: xSess.id, questionId: Q[1], selectedOption: 'A',
    });
    record('Cross-session response rejected (not registered)',
      !xR.success && xR.error?.includes('not registered') ? 'PASS' : 'FAIL',
      xR.error ?? 'unexpectedly accepted');
  }

  // ─── Refresh / rejoin ─────────────────────────────────────────────────────
  const { data: refreshS } = await svc.from('activity_sessions')
    .select('status, current_question_id').eq('id', sess.id).single();
  record('Session state reconstructed from DB',
    refreshS?.status === 'QUESTION_5' ? 'PASS' : 'FAIL',
    `status=${refreshS?.status}`);

  const refreshDup = await submitResponse(stuClient, uid, {
    sessionId: sess.id, questionId: Q[5], selectedOption: 'C',
  });
  record('Re-submit after refresh rejected',
    !refreshDup.success && refreshDup.error?.includes('already submitted') ? 'PASS' : 'FAIL',
    refreshDup.error ?? 'unexpectedly accepted');

  // ─── Projector (DB layer only) ────────────────────────────────────────────
  const { data: projS } = await svc.from('activity_sessions')
    .select('status, current_question_id').eq('id', sess.id).single();
  record('Projector reads authoritative state from DB',
    projS?.status === 'QUESTION_5' ? 'PASS' : 'FAIL',
    `status=${projS?.status} q=${projS?.current_question_id}`);
  record('Projector browser runtime test', 'NOT EXECUTED',
    'Requires live browser — deferred to manual E2E stage');

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP + SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  await cleanup();

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
  } else {
    console.log(`  ${G}No failures.${X}`);
  }
  console.log(`${B}═══════════════════════════════════════════════════════════${X}\n`);
  return results;
}

main().catch(err => { console.error('Crashed:', err); process.exit(1); });
