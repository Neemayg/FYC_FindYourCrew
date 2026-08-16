/**
 * FYC Stage 10.3E — Real Group Reveal Integration Test
 *
 * This script runs the group reveal integration verification against the live staging Supabase.
 * It sets up a matched session (FYC-STAGE10-3D-MATCHING) with 10 participants:
 * - 8 eligible (2 groups of 4)
 * - 2 standby (since 10 % 4 = 2)
 *
 * Verifies:
 * 1. Admin state transition boundary (MATCHING -> GROUP_REVEAL).
 * 2. RLS blocks unauthorized student / anon status changes.
 * 3. Individual student group resolution (everyone gets their exact crew of 4).
 * 4. Privacy/Data Isolation (Student A cannot select other groups, other profiles, or other responses).
 * 5. Standby experience (standby students get no groups/crew, UI handles standby).
 * 6. DB-layer projector sync (sees GROUP_REVEAL status, hides sensitive fields).
 * 7. Refresh/Rejoin (idempotency check).
 * 8. Group immutability (assignments before reveal vs after reveal are identical).
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

// ─── getMyCrew replica (mirrors Actions logic exactly with explicit client) ──
interface Teammate {
  id: string;
  fullName: string;
  branch: string;
  year: number;
  isCheckedIn: boolean;
}

interface CrewResult {
  success: boolean;
  groupId?: string;
  groupCode?: string;
  isVerified?: boolean;
  isCheckedIn?: boolean;
  members?: Teammate[];
  error?: string;
}

async function getMyCrew(client: SupabaseClient, userId: string, sessionId: string): Promise<CrewResult> {
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
    .select('id, group_code, is_verified')
    .eq('session_id', sessionId)
    .in('id', groupIds)
    .maybeSingle();

  if (groupError || !group) {
    return { success: false, error: 'You have not been matched to a crew in this session.' };
  }

  const { data: groupMembers, error: membersError } = await client
    .from('group_members')
    .select('participant_id, is_checked_in')
    .eq('group_id', group.id);

  if (membersError || !groupMembers) {
    return { success: false, error: 'Failed to retrieve group members.' };
  }

  if (groupMembers.length !== 4) {
    return {
      success: false,
      error: `Inconsistent group size detected (${groupMembers.length} members).`,
    };
  }

  const memberIds = groupMembers.map((gm) => gm.participant_id);
  const myGM = groupMembers.find((gm) => gm.participant_id === userId);
  const isCheckedIn = myGM ? myGM.is_checked_in : false;

  const { data: profiles, error: profileError } = await client
    .from('participants')
    .select('id, full_name, branch, year')
    .in('id', memberIds);

  if (profileError || !profiles) {
    return { success: false, error: 'Failed to load crew profiles.' };
  }

  // Exclude current student from teammate list
  const teammates = profiles
    .filter((p) => p.id !== userId)
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
  const incomplete: string[] = [];
  registrations?.forEach((reg: any) => {
    const v = respMap[reg.participant_id];
    if (v && v.length === 5 && v.every(a => a !== null)) {
      complete.push({ id: reg.participant_id, vector: v });
    } else {
      incomplete.push(reg.participant_id);
    }
  });

  const sorted = [...(registrations || [])]
    .filter(r => !incomplete.includes(r.participant_id))
    .sort((a: any, b: any) => {
      const d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return d !== 0 ? d : a.participant_id.localeCompare(b.participant_id);
    });

  const R = complete.length % 4;
  const standbyIds = new Set<string>();
  const eligibleIds = new Set<string>();
  const standbyRegIds: string[] = [];
  const eligibleRegIds: string[] = [];

  sorted.forEach((reg: any, i: number) => {
    if (i >= sorted.length - R) {
      standbyIds.add(reg.participant_id); standbyRegIds.push(reg.participant_id);
    } else {
      eligibleIds.add(reg.participant_id); eligibleRegIds.push(reg.participant_id);
    }
  });

  const cohort = complete.filter(c => eligibleIds.has(c.id));

  if (incomplete.length > 0)
    await client.from('session_participants').update({ status: 'INACTIVE' })
      .eq('session_id', sessionId).in('participant_id', incomplete);
  if (standbyRegIds.length > 0)
    await client.from('session_participants').update({ status: 'STANDBY' })
      .eq('session_id', sessionId).in('participant_id', standbyRegIds);
  if (eligibleRegIds.length > 0)
    await client.from('session_participants').update({ status: 'ELIGIBLE' })
      .eq('session_id', sessionId).in('participant_id', eligibleRegIds);

  const seed = hashString(sessionId + 'AP_FYC_SEED_CONST');
  const prng = createPRNG(seed);
  const initial = greedyInitialization(cohort, questionWeights);
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
  ['B','B','B','B','B'],
  ['C','D','A','B','C'],
  ['D','C','B','A','D']
];

interface TestParticipant {
  uid: string;
  email: string;
}

async function populate(sessionId: string, n: number, qIds: number[]): Promise<TestParticipant[]> {
  const list: TestParticipant[] = [];
  for (let i = 0; i < n; i++) {
    const email = `fyc-3e-p${i}@staging.test`;
    const { data: ad } = await svc.auth.admin.createUser({
      email, password: 'FycReveal3e!', email_confirm: true
    });
    const uid = ad?.user?.id;
    if (!uid) throw new Error(`Auth user creation failed for index ${i}`);
    authIds.push(uid);

    await svc.from('participants').upsert({
      id: uid, full_name: `Student Reveal ${i}`, email,
      phone: `987654321${i}`, branch: i < 4 ? 'CS' : i < 8 ? 'EC' : 'ME', year: 1, consent_status: true
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

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${B}═══════════════════════════════════════════════════════════${X}`);
  console.log(`${B}  FYC STAGE 10.3E — GROUP REVEAL INTEGRATION TEST           ${X}`);
  console.log(`${B}═══════════════════════════════════════════════════════════${X}\n`);

  // Load question IDs
  const { data: qs } = await svc.from('questions').select('id').order('question_number');
  if (!qs || qs.length !== 5) { console.error('Cannot load questions'); process.exit(1); }
  const qIds = qs.map((q: any) => q.id);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 1 — USE MATCHED SESSION (FYC-STAGE10-3D-MATCHING)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`${B}PART 1 — SETUP MATCHED SESSION${X}`);
  const { data: mainSess } = await svc.from('activity_sessions')
    .insert({ name: 'FYC-STAGE10-3D-MATCHING', status: 'LOBBY' })
    .select('id, status').single();
  if (!mainSess) { console.error('Session creation failed'); process.exit(1); }
  sessIds.push(mainSess.id);

  // Register 10 participants (8 eligible -> 2 groups, 2 standby -> cutoff)
  const ps = await populate(mainSess.id, 10, qIds);
  console.log(`  Registered 10 participants (8 eligible + 2 standby)`);

  // Run matching engine to match and persist groups
  const initialGroups = await runMatchingEngine(mainSess.id, svc);
  console.log(`  Matching engine executed. Groups persisted.`);

  // Get persisted group details
  const { data: groups } = await svc.from('groups').select('*').eq('session_id', mainSess.id);
  const groupIds = groups?.map(g => g.id) || [];
  const groupCodes = groups?.map(g => g.group_code) || [];
  const { data: dbMembers } = await svc.from('group_members').select('*').in('group_id', groupIds);

  console.log(`    Session ID:  ${mainSess.id}`);
  console.log(`    Groups:      ${groupCodes.join(', ')}`);
  console.log(`    Assignments: ${dbMembers?.length ?? 0} rows`);

  assertEq('Main session matched to exactly 2 groups', groups?.length, 2);
  assertEq('Main session has 8 matched members', dbMembers?.length, 8);

  // Save Group A & B info for RLS tests
  const groupAId = groups?.[0]?.id;
  const groupBId = groups?.[1]?.id;
  const groupAMembers = dbMembers?.filter(m => m.group_id === groupAId).map(m => m.participant_id) || [];
  const groupBMembers = dbMembers?.filter(m => m.group_id === groupBId).map(m => m.participant_id) || [];

  // Authenticate Student A (from Group A)
  const studentA = ps.find(p => p.uid === groupAMembers[0])!;
  const stuAClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await stuAClient.auth.signInWithPassword({ email: studentA.email, password: 'FycReveal3e!' });

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 2 — STATE TRANSITION BOUNDARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 2 — STATE TRANSITION BOUNDARY${X}`);

  // 1. Direct transition from LOBBY directly to GROUP_REVEAL should be rejected (expected origins = ['MATCHING', 'GROUP_REVEAL'])
  const { data: lobSess } = await svc.from('activity_sessions').insert({ name: 'FYC-3E-LOBBY', status: 'LOBBY' }).select('id').single();
  if (lobSess) {
    sessIds.push(lobSess.id);
    const { data: failOk } = await svc.rpc('transition_session_status', {
      p_session_id: lobSess.id, p_target_status: 'GROUP_REVEAL', p_question_id: null,
      p_expected_current_statuses: ['MATCHING', 'GROUP_REVEAL']
    });
    record('Transition directly from LOBBY -> GROUP_REVEAL rejected', !failOk ? 'PASS' : 'FAIL');
  }

  // 2. Student client cannot UPDATE status directly via table update (RLS)
  const { data: statusBefore } = await svc.from('activity_sessions').select('status').eq('id', mainSess.id).single();
  const { data: stuUpdData, error: stuUpdErr } = await stuAClient.from('activity_sessions')
    .update({ status: 'GROUP_REVEAL' }).eq('id', mainSess.id).select();
  const { data: statusAfter } = await svc.from('activity_sessions').select('status').eq('id', mainSess.id).single();

  const blocked = statusBefore?.status === statusAfter?.status && (!stuUpdData || stuUpdData.length === 0);
  record('Student cannot UPDATE activity_sessions.status directly (RLS)',
    blocked ? 'PASS' : 'FAIL',
    stuUpdErr ? `error: ${stuUpdErr.code}` : `data returned length: ${stuUpdData?.length ?? 0}`);

  // 3. Admin transitions MATCHING -> GROUP_REVEAL successfully
  const { data: transOk, error: transErr } = await svc.rpc('transition_session_status', {
    p_session_id: mainSess.id, p_target_status: 'GROUP_REVEAL', p_question_id: null,
    p_expected_current_statuses: ['MATCHING', 'GROUP_REVEAL']
  });
  record('Admin transitions MATCHING -> GROUP_REVEAL successfully',
    transOk ? 'PASS' : 'FAIL', transErr?.message ?? 'ok');

  const { data: mainSessPost } = await svc.from('activity_sessions').select('status').eq('id', mainSess.id).single();
  assertEq('Main session status in DB is GROUP_REVEAL', mainSessPost?.status, 'GROUP_REVEAL');

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 3 — STUDENT GROUP RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 3 — STUDENT GROUP RESOLUTION (each of the 8 participants)${X}`);

  for (let idx = 0; idx < 8; idx++) {
    const student = ps[idx];
    const isGroupA = groupAMembers.includes(student.uid);
    const myGroupId = isGroupA ? groupAId : groupBId;
    const expectedTeammates = isGroupA 
      ? groupAMembers.filter(uid => uid !== student.uid)
      : groupBMembers.filter(uid => uid !== student.uid);

    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await client.auth.signInWithPassword({ email: student.email, password: 'FycReveal3e!' });

    const crew = await getMyCrew(client, student.uid, mainSess.id);
    record(`Student ${idx + 1} resolves crew successfully`, crew.success ? 'PASS' : 'FAIL', crew.error ?? 'ok');
    
    if (crew.success) {
      assertEq(`  Student ${idx + 1} gets exactly their matched group ID`, crew.groupId, myGroupId);
      assertEq(`  Student ${idx + 1} teammates list has size 3`, crew.members?.length, 3);
      const teamUids = crew.members?.map(m => m.id) || [];
      const matchesAll = expectedTeammates.every(uid => teamUids.includes(uid));
      record(`  Student ${idx + 1} crew matches matched cohort members`, matchesAll ? 'PASS' : 'FAIL');
      
      // Verify profile fields are present
      const allFieldsPresent = crew.members?.every(m => m.fullName && m.branch && m.year !== undefined);
      record(`  Teammate profile cards contain name/branch/year`, allFieldsPresent ? 'PASS' : 'FAIL');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 4 — PRIVACY / DATA ISOLATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 4 — PRIVACY / DATA ISOLATION (Student A perspective)${X}`);

  // 1. Direct query groups: Student A must only see Group A, NOT Group B
  const { data: visibleGroups } = await stuAClient.from('groups').select('*').eq('session_id', mainSess.id);
  assertEq('Student A only sees 1 group (Group A)', visibleGroups?.length, 1);
  record('Student A cannot select Group B from groups table',
    visibleGroups?.every(g => g.id === groupAId) ? 'PASS' : 'FAIL');

  // 2. Direct query group_members: Student A must only see Group A members
  const { data: visibleMembers } = await stuAClient.from('group_members').select('*');
  const allGroupAMembers = visibleMembers?.every(m => m.group_id === groupAId);
  record('Student A only sees Group A members in group_members table',
    allGroupAMembers ? 'PASS' : 'FAIL', `visible counts: ${visibleMembers?.length ?? 0}`);

  // 3. Direct query participants (profiles): Student A can only select Group A profiles
  const groupBMemberId = groupBMembers[0];
  const { data: otherProfile } = await stuAClient.from('participants').select('*').eq('id', groupBMemberId);
  record('Student A direct query for Group B participant profile returns 0 rows (RLS blocked)',
    !otherProfile || otherProfile.length === 0 ? 'PASS' : 'FAIL',
    otherProfile && otherProfile.length > 0 ? `returned profile name: ${otherProfile[0].full_name}` : '0 rows returned');

  // 4. Direct query responses: Student A can only select their own responses, NOT Group B responses
  const { data: otherResponses } = await stuAClient.from('responses').select('*').eq('participant_id', groupBMemberId);
  record('Student A direct query for Group B participant responses returns 0 rows (RLS blocked)',
    !otherResponses || otherResponses.length === 0 ? 'PASS' : 'FAIL',
    otherResponses && otherResponses.length > 0 ? `returned ${otherResponses.length} rows` : '0 rows returned');

  // 5. Exclude sensitive fields from getMyCrew
  const crewRes = await getMyCrew(stuAClient, studentA.uid, mainSess.id);
  if (crewRes.success && crewRes.members) {
    const hasSensitive = crewRes.members.some((m: any) => m.email || m.phone || m.vector || m.responses);
    record('Permitted teammate profile fields only (no email/phone/responses leaked in getMyCrew)',
      !hasSensitive ? 'PASS' : 'FAIL',
      hasSensitive ? 'VIOLATION: leaked email/phone/vector!' : 'ok');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 5 — STANDBY EXPERIENCE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 5 — STANDBY EXPERIENCE${X}`);
  const standbyStudent = ps[8]; // index 8 is standby (since N=10, R=2)
  const sbClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await sbClient.auth.signInWithPassword({ email: standbyStudent.email, password: 'FycReveal3e!' });

  const sbRes = await getMyCrew(sbClient, standbyStudent.uid, mainSess.id);
  const correctError = !sbRes.success && (sbRes.error?.includes('not been matched') || sbRes.error?.includes('No group membership records found.'));
  record('Standby getMyCrew returns match error',
    correctError ? 'PASS' : 'FAIL',
    sbRes.error ?? 'matched?');

  const { data: sbVisibleGroups } = await sbClient.from('groups').select('*');
  assertEq('Standby student sees 0 groups in groups table', sbVisibleGroups?.length ?? 0, 0);

  const { data: sbVisibleMembers } = await sbClient.from('group_members').select('*');
  assertEq('Standby student sees 0 memberships in group_members table', sbVisibleMembers?.length ?? 0, 0);

  const { data: sbVisibleProfiles } = await sbClient.from('participants').select('*');
  assertEq('Standby student sees 0 other participant profiles',
    sbVisibleProfiles?.filter(p => p.id !== standbyStudent.uid).length ?? 0, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 6 — REFRESH / REJOIN
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 6 — REFRESH / REJOIN${X}`);
  const refresh1 = await getMyCrew(stuAClient, studentA.uid, mainSess.id);
  const refresh2 = await getMyCrew(stuAClient, studentA.uid, mainSess.id);
  assertEq('Refresh returns identical groupCode', refresh1.groupCode, refresh2.groupCode);
  const sig1 = refresh1.members?.map(m => m.id).sort().join('|');
  const sig2 = refresh2.members?.map(m => m.id).sort().join('|');
  assertEq('Refresh returns identical teammates list', sig1, sig2);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 7 — CROSS-GROUP ISOLATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 7 — CROSS-GROUP ISOLATION${X}`);
  // Student A tries to query Group B members list directly through group_members select
  const { data: groupBRows } = await stuAClient.from('group_members').select('*').eq('group_id', groupBId);
  assertEq('Student A querying Group B group_members directly returns 0 rows', groupBRows?.length ?? 0, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 8 — GROUP IMMUTABILITY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 8 — GROUP IMMUTABILITY${X}`);
  // Check that group membership has not changed from 10.3D results
  const originalMemberUids = dbMembers?.map(m => m.participant_id).sort().join('|');
  const { data: postRevealMembers } = await svc.from('group_members').select('participant_id').in('group_id', groupIds);
  const currentMemberUids = postRevealMembers?.map(m => m.participant_id).sort().join('|');
  assertEq('Group membership list is identical before vs after reveal transition', originalMemberUids, currentMemberUids);

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 9 — PROJECTOR DB-LAYER
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}PART 9 — PROJECTOR DB-LAYER${X}`);
  const { data: projSess } = await svc.from('activity_sessions').select('*').eq('id', mainSess.id).single();
  assertEq('Projector reads status as GROUP_REVEAL', projSess?.status, 'GROUP_REVEAL');
  
  // Public projector queries cannot read sensitive participant fields (emails, phones)
  const { data: publicParticipants } = await anon.from('participants').select('email, phone');
  const allNull = publicParticipants?.every(p => p.email === undefined && p.phone === undefined);
  record('Teammate emails/phones are fully hidden from anonymous/projector queries',
    allNull || (publicParticipants?.length === 0) ? 'PASS' : 'FAIL');

  record('Projector browser runtime test', 'NOT EXECUTED', 'Requires live browser — deferred to E2E stage');

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
    console.log(`  ${G}No failures.${X}`);
  }
  console.log(`${B}═══════════════════════════════════════════════════════════${X}\n`);

  // Share results with report builder
  (global as any).__revealResults = { results, mainSessId: mainSess.id };
}

main().catch(err => { console.error('Crashed:', err); process.exit(1); });
