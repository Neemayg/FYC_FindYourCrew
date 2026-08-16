/**
 * FYC Stage 10.3F — Real Physical Crew Verification Integration Test
 *
 * Runs the physical verification flow and trigger validation against Supabase staging.
 *
 * Key Steps:
 * 1. Setup session `FYC-STAGE10-3F-VERIFICATION` (8 participants -> 2 groups of 4).
 * 2. Transition status to GROUP_REVEAL.
 * 3. Verify initial state: is_verified = false, is_checked_in = false, chat_enabled = false.
 * 4. Legitimate check-in progression for Group 1 (1/4 -> 2/4 -> 3/4 -> 4/4).
 * 5. Verify database trigger `tr_check_group_verification` fires on 4/4 check-in and sets groups.is_verified = true.
 * 6. Test boundary/invalid checks: invalid code, another group's code, empty code, duplicate check-ins.
 * 7. Test cross-group check-in: Group B student tries to check in Group A (blocked).
 * 8. RLS protection: student cannot update teammate check-in rows directly.
 * 9. Legitimate check-in progression for Group 2 -> verified.
 * 10. Realtime & Projector DB-layer audits.
 *
 * NEVER prints secret keys or passwords.
 */

import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  fs.readFileSync(path.resolve('.env.local'), 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#\s=]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  });
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Matching algorithm imports ──────────────────────────────────────────────
import { hashString, createPRNG } from '../lib/matching/prng';
import { greedyInitialization, optimizeGroups } from '../lib/matching/grouping';
import { validateGroups } from '../lib/matching/validator';
import { calculateGroupSimilarity } from '../lib/matching/compatibility';
import type { Candidate, GroupResult } from '../types';

// ─── Output helpers ───────────────────────────────────────────────────────────
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

// ─── joinCrewVerification replica (mirrors Actions logic exactly with client) ─
interface VerificationResponse {
  success: boolean;
  error?: string;
}

async function joinCrewVerification(
  client: SupabaseClient, userId: string, sessionId: string, typedCode: string
): Promise<VerificationResponse> {
  const { data: session } = await client
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

  if (session.timer_started_at && session.timer_duration) {
    const timerStarted = new Date(session.timer_started_at).getTime();
    const now = Date.now();
    const expiry = timerStarted + session.timer_duration * 1000;
    if (now > expiry + 1500) {
      return { success: false, error: 'Verification period expired. Please contact coordinators.' };
    }
  }

  const { data: memberships, error: membershipError } = await client
    .from('group_members')
    .select('group_id')
    .eq('participant_id', userId);

  if (membershipError || !memberships || memberships.length === 0) {
    return { success: false, error: 'No group membership records found.' };
  }

  const groupIds = memberships.map((m) => m.group_id);

  const { data: group, error: groupError } = await client
    .from('groups')
    .select('id, group_code')
    .eq('session_id', sessionId)
    .in('id', groupIds)
    .maybeSingle();

  if (groupError || !group) {
    return { success: false, error: 'You are not matched to any group in this session.' };
  }

  if (group.group_code.trim().toUpperCase() !== typedCode.trim().toUpperCase()) {
    return { success: false, error: 'Incorrect crew code. You can only verify your own matched crew.' };
  }

  const { error: updateError } = await client
    .from('group_members')
    .update({
      is_checked_in: true,
      checked_in_at: new Date().toISOString(),
    })
    .eq('group_id', group.id)
    .eq('participant_id', userId);

  if (updateError) {
    console.error('Check-in status update failed:', updateError);
    return { success: false, error: 'Failed to record your check-in presence.' };
  }

  return { success: true };
}

// ─── runMatchingEngine (production clone with injected client) ───────────────
async function runMatchingEngine(sessionId: string, client: SupabaseClient) {
  const { data: registrations } = await client
    .from('session_participants').select('participant_id, status, created_at').eq('session_id', sessionId);
  const { data: responses } = await client
    .from('responses').select('participant_id, question_id, selected_option').eq('session_id', sessionId);
  const { data: questions } = await client.from('questions')
    .select('id, question_number, weight').order('question_number', { ascending: true });

  const questionWeights = questions ? questions.map((q: any) => Number(q.weight)) : [1,1,1,1,1];
  const qIdxMap: Record<number, number> = {};
  if (questions) questions.forEach((q: any, i: number) => { qIdxMap[q.id] = i; });

  const respMap: Record<string, (string | null)[]> = {};
  responses?.forEach((r: any) => {
    if (!respMap[r.participant_id]) respMap[r.participant_id] = [null,null,null,null,null];
    const idx = qIdxMap[r.question_id];
    if (idx !== undefined && idx >= 0 && idx < 5) respMap[r.participant_id][idx] = r.selected_option;
  });

  const complete: Candidate[] = [];
  registrations?.forEach((reg: any) => {
    const v = respMap[reg.participant_id];
    if (v && v.length === 5 && v.every(a => a !== null)) {
      complete.push({ id: reg.participant_id, vector: v });
    }
  });

  const seed = hashString(sessionId + 'AP_FYC_SEED_CONST');
  const prng = createPRNG(seed);
  const initial = greedyInitialization(complete, questionWeights);
  const optimized = optimizeGroups(initial, 5000, prng, questionWeights);

  const payload = optimized.map(g => ({
    group_code: g.groupCode,
    members: g.members.map(m => ({ id: m.id })),
  }));

  await client.rpc('persist_matching', { p_session_id: sessionId, p_groups: payload });
  await client.from('activity_sessions').update({ status: 'MATCHING' }).eq('id', sessionId);
  return optimized;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
const sessIds: string[] = [];
const authIds: string[] = [];
async function cleanup() {
  console.log(`\n${B}CLEANUP${X}`);
  for (const id of sessIds) {
    await svc.from('activity_sessions').delete().eq('id', id);
    console.log(`  Deleted session ${id}`);
  }
  for (const id of authIds) {
    await svc.auth.admin.deleteUser(id);
    console.log(`  Deleted auth user ${id}`);
  }
}

// ─── Helper: populate a session with participants + answers ──────────────────
const PATTERNS = [
  ['A','A','A','A','A'],
  ['A','A','A','A','A'],
  ['A','A','A','A','A'],
  ['A','A','A','A','A'],
  ['B','B','B','B','B'],
  ['B','B','B','B','B'],
  ['B','B','B','B','B'],
  ['B','B','B','B','B']
];

interface TestParticipant {
  uid: string;
  email: string;
}

async function populate(sessionId: string, n: number, qIds: number[]): Promise<TestParticipant[]> {
  const list: TestParticipant[] = [];
  for (let i = 0; i < n; i++) {
    const email = `fyc-3f-p${i}@staging.test`;
    const { data: ad } = await svc.auth.admin.createUser({
      email, password: 'FycVerify3f!', email_confirm: true
    });
    const uid = ad?.user?.id;
    if (!uid) throw new Error(`Auth user creation failed for index ${i}`);
    authIds.push(uid);

    await svc.from('participants').upsert({
      id: uid, full_name: `Student Verify ${i}`, email,
      phone: `987654321${i}`, branch: i < 4 ? 'CS' : 'EC', year: 1, consent_status: true
    });

    await new Promise(r => setTimeout(r, 2));
    await svc.from('session_participants').insert({
      session_id: sessionId, participant_id: uid, status: 'REGISTERED'
    });

    const pat = PATTERNS[i % PATTERNS.length];
    for (let qi = 0; qi < 5; qi++) {
      await svc.from('responses').insert({
        session_id: sessionId, participant_id: uid,
        question_id: qIds[qi], selected_option: pat[qi]
      });
    }
    list.push({ uid, email });
  }
  return list;
}

// ─── Fallback pgQuery ─────────────────────────────────────────────────────────
async function pgQuery(sql: string): Promise<{ rows?: any[]; error?: string } | null> {
  const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
  try {
    const resp = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    });
    return await resp.json();
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${B}═══════════════════════════════════════════════════════════${X}`);
  console.log(`${B}  FYC STAGE 10.3F — REAL PHYSICAL CREW VERIFICATION TEST    ${X}`);
  console.log(`${B}═══════════════════════════════════════════════════════════${X}\n`);

  // Load question IDs
  const { data: qs } = await svc.from('questions').select('id').order('question_number');
  if (!qs || qs.length !== 5) { console.error('Cannot load questions'); process.exit(1); }
  const qIds = qs.map((q: any) => q.id);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 1 — SESSION CREATION & MATCHING
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`${B}PART 1 — SETUP MATCHED SESSION${X}`);
  const { data: mainSess } = await svc.from('activity_sessions')
    .insert({ name: 'FYC-STAGE10-3F-VERIFICATION', status: 'LOBBY' })
    .select('id, status').single();
  if (!mainSess) { console.error('Session creation failed'); process.exit(1); }
  sessIds.push(mainSess.id);

  // Register 8 participants
  const ps = await populate(mainSess.id, 8, qIds);
  console.log(`  Registered 8 participants`);

  // Run matching
  await runMatchingEngine(mainSess.id, svc);
  console.log(`  Matching completed and groups saved.`);

  const { data: groups } = await svc.from('groups').select('*').eq('session_id', mainSess.id);
  const groupIds = groups?.map(g => g.id) || [];
  const groupCodes = groups?.map(g => g.group_code) || [];
  const { data: dbMembers } = await svc.from('group_members').select('*').in('group_id', groupIds);

  assertEq('Exactly 2 groups generated', groups?.length, 2);
  assertEq('Exactly 8 group members registered in groups', dbMembers?.length, 8);

  const groupAId = groups?.[0]?.id;
  const groupBId = groups?.[1]?.id;
  const groupACode = groups?.[0]?.group_code;
  const groupBCode = groups?.[1]?.group_code;
  const groupAMembers = dbMembers?.filter(m => m.group_id === groupAId).map(m => m.participant_id) || [];
  const groupBMembers = dbMembers?.filter(m => m.group_id === groupBId).map(m => m.participant_id) || [];

  // Authenticate student clients
  const stuClients: Record<string, SupabaseClient> = {};
  for (const student of ps) {
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await client.auth.signInWithPassword({ email: student.email, password: 'FycVerify3f!' });
    stuClients[student.uid] = client;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 2 — TRANSITION TO GROUP_REVEAL
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 2 — TRANSITION TO GROUP_REVEAL${X}`);
  await svc.rpc('transition_session_status', {
    p_session_id: mainSess.id, p_target_status: 'GROUP_REVEAL', p_question_id: null,
    p_expected_current_statuses: ['MATCHING']
  });
  const { data: sessStatus } = await svc.from('activity_sessions').select('status').eq('id', mainSess.id).single();
  assertEq('Session transitioned to GROUP_REVEAL', sessStatus?.status, 'GROUP_REVEAL');

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 3 — INITIAL VERIFICATION STATE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 3 — INITIAL VERIFICATION STATE${X}`);
  const { data: grpsInit } = await svc.from('groups').select('is_verified, chat_enabled').in('id', groupIds);
  const allUnverified = grpsInit?.every(g => !g.is_verified && !g.chat_enabled);
  record('Initial groups: is_verified = FALSE, chat_enabled = FALSE', allUnverified ? 'PASS' : 'FAIL');

  const allMembersUnchecked = dbMembers?.every(m => !m.is_checked_in);
  record('Initial group_members: is_checked_in = FALSE for all members', allMembersUnchecked ? 'PASS' : 'FAIL');

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 4 — VALID VERIFICATION PROGRESSION (Group 1 / Group A)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 4 — VALID VERIFICATION HANDSHAKE PROGRESSION (Group A)$/X`);

  for (let i = 0; i < 4; i++) {
    const memberId = groupAMembers[i];
    const client = stuClients[memberId];

    const res = await joinCrewVerification(client, memberId, mainSess.id, groupACode);
    record(`Member ${i + 1} checks in with correct code (${groupACode})`, res.success ? 'PASS' : 'FAIL', res.error ?? 'ok');

    // Verify row checked in state
    const { data: mbrRow } = await svc.from('group_members')
      .select('is_checked_in, checked_in_at')
      .eq('group_id', groupAId)
      .eq('participant_id', memberId)
      .single();

    record(`  is_checked_in changes to TRUE for Member ${i + 1}`, mbrRow?.is_checked_in ? 'PASS' : 'FAIL');
    record(`  checked_in_at timestamp is set`, mbrRow?.checked_in_at ? 'PASS' : 'FAIL');

    // Verify aggregate check-in count
    const { data: grpMbrs } = await svc.from('group_members').select('is_checked_in').eq('group_id', groupAId);
    const checkedCount = grpMbrs?.filter(m => m.is_checked_in).length ?? 0;
    assertEq(`  Check-in progression count: ${checkedCount} / 4`, checkedCount, i + 1);

    // Verify verification state (remains false until 4/4)
    const { data: grpRow } = await svc.from('groups').select('is_verified').eq('id', groupAId).single();
    if (i < 3) {
      assertEq(`  Group is_verified remains FALSE at count ${checkedCount}`, grpRow?.is_verified, false);
    } else {
      // ═══════════════════════════════════════════════════════════════════════
      // PART 5 — AUTOMATIC GROUP VERIFICATION TRIGGER
      // ═══════════════════════════════════════════════════════════════════════
      console.log(`\n${B}PART 5 — AUTOMATIC GROUP VERIFICATION TRIGGER${X}`);
      assertEq('  Trigger auto-sets groups.is_verified = TRUE on 4th check-in', grpRow?.is_verified, true);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 6 — INVALID GROUP CODE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 6 — INVALID GROUP CODE TESTS${X}`);
  const bMemberId = groupBMembers[0];
  const bClient = stuClients[bMemberId];

  // A. Completely invalid code
  const rA = await joinCrewVerification(bClient, bMemberId, mainSess.id, 'INVALID-CODE');
  record('Completely invalid code rejected', !rA.success ? 'PASS' : 'FAIL', rA.error ?? 'ok');

  // B. Another group's code (Group B student uses Group A code)
  const rB = await joinCrewVerification(bClient, bMemberId, mainSess.id, groupACode);
  record('Another group code rejected', !rB.success ? 'PASS' : 'FAIL', rB.error ?? 'ok');

  // C. Malformed / empty code
  const rC = await joinCrewVerification(bClient, bMemberId, mainSess.id, '');
  record('Malformed empty code rejected', !rC.success ? 'PASS' : 'FAIL', rC.error ?? 'ok');

  // Verify no check-in occurred for Group B members
  const { data: grpBMbrs } = await svc.from('group_members').select('is_checked_in').eq('group_id', groupBId);
  const grpBChecked = grpBMbrs?.filter(m => m.is_checked_in).length ?? 0;
  assertEq('Group B checked in count remains 0', grpBChecked, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 7 — UNAUTHORIZED / CROSS-GROUP CHECK-IN
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 7 — UNAUTHORIZED / CROSS-GROUP CHECK-IN (RLS)${X}`);
  
  // Student B client attempts to update Student A's group_members check-in status directly (bypass API)
  const aMemberId = groupAMembers[0];
  const { data: crossData, error: crossErr } = await bClient.from('group_members')
    .update({ is_checked_in: true })
    .eq('group_id', groupAId)
    .eq('participant_id', aMemberId)
    .select();
  const crossBlocked = !crossData || crossData.length === 0;
  record('Cross-group direct table UPDATE blocked (RLS)',
    crossBlocked ? 'PASS' : 'FAIL',
    crossErr ? `error: ${crossErr.code}` : `returned rowcount: ${crossData?.length ?? 0}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 8 — DUPLICATE CHECK-IN
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 8 — DUPLICATE CHECK-IN${X}`);
  const firstMbr = groupAMembers[0];
  const firstClient = stuClients[firstMbr];
  
  const dupRes = await joinCrewVerification(firstClient, firstMbr, mainSess.id, groupACode);
  record('Duplicate check-in operation is safely idempotent', dupRes.success ? 'PASS' : 'FAIL', dupRes.error ?? 'ok');
  
  const { data: grpMbrsPostDup } = await svc.from('group_members').select('is_checked_in').eq('group_id', groupAId);
  const countPostDup = grpMbrsPostDup?.filter(m => m.is_checked_in).length ?? 0;
  assertEq('Verification checked-in count remains exactly 4', countPostDup, 4);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 9 — SESSION / STATE BOUNDARIES
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 9 — SESSION / STATE BOUNDARIES${X}`);

  // A. Attempt check-in on a session in LOBBY status
  const { data: lobbySess } = await svc.from('activity_sessions').insert({ name: 'FYC-3F-LOB-BOUND', status: 'LOBBY' }).select('id').single();
  if (lobbySess) {
    sessIds.push(lobbySess.id);
    await svc.from('session_participants').insert({ session_id: lobbySess.id, participant_id: firstMbr, status: 'REGISTERED' });
    const lobRes = await joinCrewVerification(firstClient, firstMbr, lobbySess.id, groupACode);
    record('Check-in rejected before GROUP_REVEAL (session is LOBBY)',
      !lobRes.success && lobRes.error?.includes('closed') ? 'PASS' : 'FAIL', lobRes.error);
  }

  // B. Attempt against an unrelated session
  const { data: otherSess } = await svc.from('activity_sessions').insert({ name: 'FYC-3F-OTHER-BOUND', status: 'GROUP_REVEAL' }).select('id').single();
  if (otherSess) {
    sessIds.push(otherSess.id);
    const otherRes = await joinCrewVerification(firstClient, firstMbr, otherSess.id, groupACode);
    record('Check-in rejected against unrelated session (student not matched)',
      !otherRes.success && otherRes.error?.includes('not matched') ? 'PASS' : 'FAIL', otherRes.error);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 10 — VERIFICATION IMMUTABILITY (Student RLS)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 10 — VERIFICATION IMMUTABILITY${X}`);
  
  // Student client attempts to reset groups.is_verified = FALSE directly
  const { data: mutSessData, error: mutSessErr } = await firstClient.from('groups')
    .update({ is_verified: false })
    .eq('id', groupAId)
    .select();
  const mutSessBlocked = !mutSessData || mutSessData.length === 0;
  record('Student client cannot update groups.is_verified (RLS blocked)',
    mutSessBlocked ? 'PASS' : 'FAIL',
    mutSessErr ? `error: ${mutSessErr.code}` : `returned count: ${mutSessData?.length ?? 0}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 11 — SECOND GROUP VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 11 — SECOND GROUP VERIFICATION (Group B)${X}`);
  
  for (let i = 0; i < 4; i++) {
    const memberId = groupBMembers[i];
    const client = stuClients[memberId];
    await joinCrewVerification(client, memberId, mainSess.id, groupBCode);
  }
  
  const { data: grpBRowPost } = await svc.from('groups').select('is_verified').eq('id', groupBId).single();
  assertEq('Group B is_verified automatically set to TRUE on 4th check-in', grpBRowPost?.is_verified, true);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 12 — REALTIME DATABASE VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 12 — REALTIME DATABASE VERIFICATION${X}`);
  const rtResult = await pgQuery(`
    SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename;
  `);
  if (rtResult?.rows) {
    const rtTables = rtResult.rows.map(r => r.tablename);
    record('groups table in supabase_realtime publication', rtTables.includes('groups') ? 'PASS' : 'FAIL');
    record('group_members table in supabase_realtime publication', rtTables.includes('group_members') ? 'PASS' : 'FAIL');
  } else {
    record('groups table in supabase_realtime publication', 'NOT EXECUTED', 'Supabase Management API query failed');
    record('group_members table in supabase_realtime publication', 'NOT EXECUTED', 'Supabase Management API query failed');
  }
  record('Browser realtime WebSocket integration', 'NOT EXECUTED', 'Requires live browser — deferred to E2E stage');

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 13 — PROJECTOR AGGREGATE STATE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 13 — PROJECTOR AGGREGATE STATE${X}`);
  const { data: projGroups } = await svc.from('groups').select('is_verified').eq('session_id', mainSess.id);
  const projVerifiedCount = projGroups?.filter(g => g.is_verified).length ?? 0;
  assertEq('Projector reads verified groups count = 2 / 2', projVerifiedCount, 2);
  
  // Public anon projector queries cannot see emails or phone numbers
  const { data: publicParticipants } = await anon.from('participants').select('email, phone');
  const hiddenOk = publicParticipants?.every(p => p.email === undefined && p.phone === undefined);
  record('Public projector queries hide participant emails/phones',
    hiddenOk || (publicParticipants?.length === 0) ? 'PASS' : 'FAIL');
  record('Browser projector route visual tests', 'NOT EXECUTED', 'Deferred to manual E2E run');

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 15 — DATABASE INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 15 — DATABASE INTEGRITY${X}`);
  const { data: finalG } = await svc.from('groups').select('id, is_verified').eq('session_id', mainSess.id);
  const { data: finalM } = await svc.from('group_members').select('id, is_checked_in').in('group_id', finalG?.map(g => g.id) ?? []);
  
  assertEq('Total final groups in session', finalG?.length, 2);
  assertEq('Total final group members in session', finalM?.length, 8);
  record('Both groups fully verified in database', finalG?.every(g => g.is_verified) ? 'PASS' : 'FAIL');
  record('All 8 participants checked in successfully', finalM?.every(m => m.is_checked_in) ? 'PASS' : 'FAIL');

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
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
    console.log(`  ${G}No failures. All critical verification checks passed.${X}`);
  }
  console.log(`${B}═══════════════════════════════════════════════════════════${X}\n`);

  (global as any).__verifyResults = { results, mainSessId: mainSess.id };
}

main().catch(err => { console.error('Crashed:', err); process.exit(1); });
