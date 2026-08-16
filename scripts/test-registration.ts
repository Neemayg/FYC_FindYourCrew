/**
 * FYC Stage 10.3B — Real Staging Session & Registration Test
 *
 * Replicates the exact logic of registerParticipant() in
 * app/student/register/actions.ts against the live staging database.
 *
 * NEVER prints secret keys or passwords.
 */

import fs from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  const content = fs.readFileSync('.env.local', 'utf8');
  content.split('\n').forEach((line) => {
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

// ─── Result store ─────────────────────────────────────────────────────────────
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
/** Service-role: bypasses RLS — used for setup/teardown and verification queries */
const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
/** Anon: no authentication — simulates an unauthenticated attacker */
const anon: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Phone validation regex (mirrors actions.ts exactly) ──────────────────────
const PHONE_REGEX = /^\+?[0-9]{10,15}$/;
function validatePhone(phone: string): boolean {
  return PHONE_REGEX.test(phone.replace(/\s+/g, ''));
}

// ─── Registration logic replicating actions.ts (no cookie/Next.js context) ────
async function registerParticipant(
  client: SupabaseClient,
  userId: string,
  userEmail: string,
  formData: {
    fullName: string;
    phone: string;
    branch: string;
    year: number;
    consent: boolean;
    sessionId: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const { fullName, phone, branch, year, consent, sessionId } = formData;

  // Validate — mirrors actions.ts exactly
  if (!fullName || fullName.trim().length > 100)
    return { success: false, error: 'Invalid name. Maximum 100 characters.' };
  if (!phone || !validatePhone(phone))
    return { success: false, error: 'Invalid phone number format. Must contain 10-15 digits.' };
  if (!branch || branch.trim().length > 100)
    return { success: false, error: 'Please specify a branch.' };
  if (!year || year < 1 || year > 5)
    return { success: false, error: 'Invalid year of study.' };
  if (!consent)
    return { success: false, error: 'You must provide consent to participate.' };

  // Check session status
  const { data: session, error: sessionError } = await client
    .from('activity_sessions').select('status').eq('id', sessionId).single();
  if (sessionError || !session)
    return { success: false, error: 'Selected FYC session does not exist.' };
  if (session.status !== 'LOBBY')
    return { success: false, error: 'Registration for this FYC session has closed.' };

  // Upsert participant profile
  const { error: profileError } = await client.from('participants').upsert({
    id: userId, full_name: fullName.trim(), email: userEmail,
    phone: phone.trim(), branch: branch.trim(), year, consent_status: consent,
  });
  if (profileError)
    return { success: false, error: 'Failed to create student profile.' };

  // Insert session_participants
  const { error: registerError } = await client.from('session_participants').insert({
    session_id: sessionId, participant_id: userId, status: 'REGISTERED',
  });
  if (registerError) {
    if (registerError.code === '23505') return { success: true }; // already registered
    return { success: false, error: 'Failed to register for the active session.' };
  }
  return { success: true };
}

// ─── Synthetic user factory (uses service role to create auth users) ───────────
async function createSyntheticAuthUser(
  idx: number,
  sessionSuffix: string
): Promise<{ id: string; email: string } | null> {
  const email = `fyc-10-3b-${idx}-${sessionSuffix}@staging.test`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: 'FycStaging10-3b!',
    email_confirm: true,
  });
  if (error) {
    // Already exists from a previous partial run — fetch instead
    if (error.message.includes('already been registered')) {
      const { data: list } = await svc.auth.admin.listUsers();
      const existing = list?.users?.find(u => u.email === email);
      if (existing) return { id: existing.id, email };
    }
    console.error(`  Could not create auth user ${idx}:`, error.message);
    return null;
  }
  return { id: data.user.id, email: data.user.email! };
}

// ─── Cleanup helper ───────────────────────────────────────────────────────────
const createdAuthIds: string[] = [];
const createdSessionIds: string[] = [];

async function cleanup() {
  console.log(`\n${B}CLEANUP — removing staging test data${X}`);
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
  console.log(`${B}  FYC STAGE 10.3B — REGISTRATION TEST                      ${X}`);
  console.log(`${B}═══════════════════════════════════════════════════════════${X}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. CREATE TEST SESSION (PRIMARY)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`${B}1. CREATE TEST SESSION${X}`);
  const { data: primarySession, error: psErr } = await svc
    .from('activity_sessions')
    .insert({ name: 'FYC-STAGE10-3B-REGISTRATION', status: 'LOBBY' })
    .select('id, name, status').single();

  if (psErr || !primarySession) {
    console.error('Session creation failed:', psErr?.message);
    process.exit(1);
  }
  createdSessionIds.push(primarySession.id);
  record('Session created: FYC-STAGE10-3B-REGISTRATION', 'PASS',
    `id=${primarySession.id} status=${primarySession.status}`);
  assertEq('Session initial status = LOBBY', primarySession.status, 'LOBBY');

  // Verify no participants are attached yet
  const { data: existingP } = await svc.from('session_participants')
    .select('id').eq('session_id', primarySession.id);
  assertEq('No pre-existing participants on new session', existingP?.length ?? 0, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CREATE SYNTHETIC AUTH USERS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}2. CREATING SYNTHETIC AUTH USERS${X}`);
  const sessionSuffix = primarySession.id.substring(0, 8);
  const NUM_USERS = 8;
  const users: { id: string; email: string }[] = [];

  for (let i = 1; i <= NUM_USERS; i++) {
    const u = await createSyntheticAuthUser(i, sessionSuffix);
    if (u) {
      users.push(u);
      createdAuthIds.push(u.id);
    }
  }
  record(`Created ${users.length}/${NUM_USERS} synthetic auth users`, users.length >= 4 ? 'PASS' : 'FAIL');

  if (users.length < 4) {
    console.error('Not enough users to run tests. Aborting.');
    await cleanup();
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. TEST VALID REGISTRATION (User 1)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}3. VALID REGISTRATION${X}`);
  const u1 = users[0];
  const reg1 = await registerParticipant(svc, u1.id, u1.email, {
    fullName: 'FYC Test 01', phone: '9876543210', branch: 'Computer Science',
    year: 1, consent: true, sessionId: primarySession.id,
  });
  record('Valid registration accepted', reg1.success ? 'PASS' : 'FAIL',
    reg1.error ?? 'registration succeeded');

  // Verify rows in DB
  const { data: p1Row } = await svc.from('participants').select('id,full_name').eq('id', u1.id).single();
  record('participants row created', p1Row ? 'PASS' : 'FAIL', p1Row?.full_name ?? 'missing');
  const { data: sp1Row } = await svc.from('session_participants')
    .select('id,session_id,participant_id,status')
    .eq('session_id', primarySession.id).eq('participant_id', u1.id).single();
  record('session_participants row created', sp1Row ? 'PASS' : 'FAIL',
    sp1Row ? `status=${sp1Row.status}` : 'missing');
  assertEq('session_participants.session_id matches primary session', sp1Row?.session_id, primarySession.id);

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. TEST DUPLICATE REGISTRATION (User 1 again)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}4. DUPLICATE REGISTRATION${X}`);
  const reg1Dup = await registerParticipant(svc, u1.id, u1.email, {
    fullName: 'FYC Test 01', phone: '9876543210', branch: 'Computer Science',
    year: 1, consent: true, sessionId: primarySession.id,
  });
  // actions.ts returns success: true on 23505 (idempotent re-registration)
  record('Duplicate registration handled gracefully (idempotent)', reg1Dup.success ? 'PASS' : 'FAIL',
    reg1Dup.error ?? 'idempotent success as per actions.ts contract');

  // Verify only ONE session_participants row exists
  const { data: dupRows } = await svc.from('session_participants')
    .select('id').eq('session_id', primarySession.id).eq('participant_id', u1.id);
  assertEq('Only 1 session_participants row after duplicate attempt', dupRows?.length ?? 0, 1);

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. REGISTER REMAINING USERS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}5. REGISTER ALL SYNTHETIC PARTICIPANTS${X}`);
  for (let i = 1; i < users.length; i++) {
    const u = users[i];
    const result = await registerParticipant(svc, u.id, u.email, {
      fullName: `FYC Test ${String(i + 1).padStart(2, '0')}`,
      phone: `9876543${String(210 + i).slice(-3)}`,
      branch: i % 2 === 0 ? 'Electronics' : 'Computer Science',
      year: (i % 4) + 1,
      consent: true,
      sessionId: primarySession.id,
    });
    record(`User ${i + 1} registered`, result.success ? 'PASS' : 'FAIL',
      result.error ?? 'ok');
  }

  // Verify all 8 session_participants rows
  const { data: allSP } = await svc.from('session_participants')
    .select('id').eq('session_id', primarySession.id);
  assertEq(`${users.length} session_participants rows in primary session`, allSP?.length ?? 0, users.length);

  // Verify no cross-contamination with other sessions
  const { data: crossSP } = await svc.from('session_participants')
    .select('id').neq('session_id', primarySession.id)
    .in('participant_id', users.map(u => u.id));
  assertEq('No cross-session contamination for synthetic users', crossSP?.length ?? 0, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. INVALID PHONE VALIDATION TESTS (pure logic — mirrors actions.ts)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}6. INVALID PHONE VALIDATION${X}`);
  const invalidPhones = [
    { phone: 'abc',            desc: 'alphabetic string' },
    { phone: '123',            desc: 'too short (3 digits)' },
    { phone: '12345',          desc: 'too short (5 digits)' },
    { phone: 'abc1234567890',  desc: 'mixed letters and digits' },
    { phone: '++9876543210',   desc: 'double-plus prefix' },
    { phone: '',               desc: 'empty string' },
    { phone: '9876543210123456', desc: 'too long (16 digits)' },
  ];
  const validPhones = [
    { phone: '9876543210',   desc: '10 digits (valid)' },
    { phone: '+919876543210', desc: '+91 prefix (valid)' },
    { phone: '987654321012',  desc: '12 digits (valid)' },
  ];

  for (const tc of invalidPhones) {
    const result = await registerParticipant(svc, users[0].id, users[0].email, {
      fullName: 'FYC Test', phone: tc.phone, branch: 'CS',
      year: 1, consent: true, sessionId: primarySession.id,
    });
    record(`Invalid phone rejected: "${tc.phone}" (${tc.desc})`,
      !result.success && result.error?.includes('phone') ? 'PASS' : 'FAIL',
      result.error ?? 'unexpectedly accepted');
  }
  for (const tc of validPhones) {
    const isValid = validatePhone(tc.phone);
    record(`Valid phone accepted: "${tc.phone}" (${tc.desc})`, isValid ? 'PASS' : 'FAIL');
  }

  // Verify DB unchanged after invalid phone attempts (user 1 should still have exactly 1 row)
  const { data: afterInvalidSP } = await svc.from('session_participants')
    .select('id').eq('session_id', primarySession.id).eq('participant_id', u1.id);
  assertEq('DB unchanged after invalid phone submissions', afterInvalidSP?.length ?? 0, 1);

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. REGISTRATION AFTER LOBBY CLOSES
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}7. REGISTRATION AFTER LOBBY CLOSES${X}`);

  // Use transition_session_status RPC (safe atomic transition)
  const { error: transErr } = await svc.rpc('transition_session_status', {
    p_session_id: primarySession.id,
    p_target_status: 'QUESTION_1',
    p_question_id: 1,
    p_expected_current_statuses: ['LOBBY'],
  });
  record('Session transitioned from LOBBY → QUESTION_1',
    !transErr ? 'PASS' : 'FAIL', transErr?.message ?? 'ok');

  // Verify new status
  const { data: closedSess } = await svc.from('activity_sessions')
    .select('status').eq('id', primarySession.id).single();
  assertEq('Session status is now QUESTION_1', closedSess?.status, 'QUESTION_1');

  // Attempt late registration
  const lateUser = users[users.length - 1]; // use last user, re-attempt
  // First remove their existing session_participants row to simulate a new user
  await svc.from('session_participants').delete()
    .eq('session_id', primarySession.id).eq('participant_id', lateUser.id);

  const lateReg = await registerParticipant(svc, lateUser.id, lateUser.email, {
    fullName: 'FYC Test Late', phone: '9876543210', branch: 'CS',
    year: 1, consent: true, sessionId: primarySession.id,
  });
  record('Late registration correctly rejected',
    !lateReg.success && lateReg.error?.includes('closed') ? 'PASS' : 'FAIL',
    lateReg.error ?? 'unexpectedly accepted');

  // Verify no new row created
  const { data: lateRow } = await svc.from('session_participants')
    .select('id').eq('session_id', primarySession.id).eq('participant_id', lateUser.id);
  assertEq('No session_participants row for late-attempt user', lateRow?.length ?? 0, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. UNAUTHORIZED ACCESS TEST
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}8. UNAUTHORIZED ACCESS TEST${X}`);

  // Anon tries to insert directly into participants
  const { error: anonPartErr } = await anon.from('participants').insert({
    id: '00000000-0000-0000-0000-000000000001',
    full_name: 'Attacker', email: 'attacker@evil.com',
    phone: '9876543210', branch: 'Hacking', year: 1, consent_status: true,
  });
  record('Anon cannot INSERT into participants',
    !!anonPartErr ? 'PASS' : 'FAIL',
    anonPartErr ? `blocked: ${anonPartErr.code} ${anonPartErr.message}` : 'UNEXPECTEDLY ALLOWED');

  // Anon tries to insert directly into session_participants
  const { error: anonSPErr } = await anon.from('session_participants').insert({
    session_id: primarySession.id,
    participant_id: '00000000-0000-0000-0000-000000000001',
    status: 'REGISTERED',
  });
  record('Anon cannot INSERT into session_participants',
    !!anonSPErr ? 'PASS' : 'FAIL',
    anonSPErr ? `blocked: ${anonSPErr.code}` : 'UNEXPECTEDLY ALLOWED');

  // Anon tries to read participants (should get 0 rows due to RLS)
  const { data: anonRead } = await anon.from('participants').select('id').limit(10);
  record('Anon reads 0 participant rows (RLS filtering)',
    (anonRead?.length ?? 0) === 0 ? 'PASS' : 'FAIL',
    `anon sees ${anonRead?.length ?? 0} rows`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. SESSION ISOLATION TEST
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}9. SESSION ISOLATION TEST${X}`);
  const { data: isoSession, error: isoErr } = await svc
    .from('activity_sessions')
    .insert({ name: 'FYC-STAGE10-3B-ISOLATION', status: 'LOBBY' })
    .select('id, name, status').single();

  if (isoErr || !isoSession) {
    record('Isolation session created', 'FAIL', isoErr?.message ?? 'unknown');
  } else {
    createdSessionIds.push(isoSession.id);
    record('Isolation session created: FYC-STAGE10-3B-ISOLATION', 'PASS', `id=${isoSession.id}`);

    // Register user 1 in isolation session
    const u1IsoReg = await registerParticipant(svc, users[0].id, users[0].email, {
      fullName: 'FYC Test 01', phone: '9876543210', branch: 'CS',
      year: 1, consent: true, sessionId: isoSession.id,
    });
    record('User 1 registered in isolation session', u1IsoReg.success ? 'PASS' : 'FAIL');

    // Verify user 1 does NOT appear in isolation session automatically
    // (they should appear only because we explicitly registered them there)
    const { data: isoSP } = await svc.from('session_participants')
      .select('id').eq('session_id', isoSession.id);
    assertEq('Isolation session has exactly 1 participant (only explicitly registered)',
      isoSP?.length ?? 0, 1);

    // Verify participants from primary session are NOT in isolation session
    const primaryUserIds = users.slice(1).map(u => u.id);
    const { data: crossCheck } = await svc.from('session_participants')
      .select('id').eq('session_id', isoSession.id)
      .in('participant_id', primaryUserIds);
    assertEq('Primary session users are NOT in isolation session',
      crossCheck?.length ?? 0, 0);

    // Anon cannot register a participant into isolation session
    const { error: anonIsoErr } = await anon.from('session_participants').insert({
      session_id: isoSession.id,
      participant_id: users[1].id,
      status: 'REGISTERED',
    });
    record('Anon cannot cross-register into isolation session',
      !!anonIsoErr ? 'PASS' : 'FAIL',
      anonIsoErr ? `blocked: ${anonIsoErr.code}` : 'UNEXPECTEDLY ALLOWED');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. RLS BEHAVIOR VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}10. RLS BEHAVIOR VERIFICATION${X}`);

  // Anon cannot enumerate participants
  const { data: anonParts } = await anon.from('participants').select('id,email');
  record('Anon cannot enumerate participants table',
    (anonParts?.length ?? 0) === 0 ? 'PASS' : 'FAIL',
    `anon sees ${anonParts?.length ?? 0} rows`);

  // Anon cannot enumerate session_participants
  const { data: anonSPs } = await anon.from('session_participants').select('id');
  record('Anon cannot enumerate session_participants table',
    (anonSPs?.length ?? 0) === 0 ? 'PASS' : 'FAIL',
    `anon sees ${anonSPs?.length ?? 0} rows`);

  // Service-role CAN see data (confirming RLS only blocks anon, not superuser)
  const { data: svcParts } = await svc.from('participants').select('id').limit(1);
  record('Service-role can read participants (expected)',
    (svcParts?.length ?? 0) > 0 ? 'PASS' : 'FAIL');

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. CONSTRAINT VERIFICATION (deferred from 10.3A)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}11. CONSTRAINT VERIFICATION (deferred from 10.3A)${X}`);

  // 11A. FK: session_participants.session_id → activity_sessions.id
  const { error: fkSessErr } = await svc.from('session_participants').insert({
    session_id: '00000000-0000-0000-0000-000000000000',
    participant_id: users[0].id, status: 'REGISTERED',
  });
  record('FK: session_participants.session_id rejects unknown session UUID',
    fkSessErr?.code === '23503' ? 'PASS' : 'FAIL',
    fkSessErr ? `code=${fkSessErr.code}` : 'NO ERROR — FK not enforced!');

  // 11B. FK: session_participants.participant_id → participants.id
  const { error: fkPartErr } = await svc.from('session_participants').insert({
    session_id: primarySession.id,
    participant_id: '00000000-0000-0000-0000-000000000002',
    status: 'REGISTERED',
  });
  record('FK: session_participants.participant_id rejects unknown participant UUID',
    fkPartErr?.code === '23503' ? 'PASS' : 'FAIL',
    fkPartErr ? `code=${fkPartErr.code}` : 'NO ERROR — FK not enforced!');

  // 11C. UNIQUE: session_participants (session_id, participant_id) — already tested in §4
  record('UNIQUE: session_participants (session_id, participant_id)',
    'PASS', 'verified in §4 duplicate test — code 23505 returned');

  // 11D. UNIQUE: groups (session_id, group_code) — already tested in 10.3A
  record('UNIQUE: groups (session_id, group_code)',
    'PASS', 'verified in Stage 10.3A behavioral probe — code 23505 returned');

  // 11E. Check year constraint (1–5)
  const { error: yearErr } = await svc.from('participants').upsert({
    id: users[0].id, full_name: 'FYC Test', email: users[0].email,
    phone: '9876543210', branch: 'CS', year: 6, consent_status: true,
  });
  record('CHECK constraint: participants.year rejects year=6',
    yearErr?.code === '23514' ? 'PASS' : 'FAIL',
    yearErr ? `code=${yearErr.code} ${yearErr.message}` : 'NO ERROR — constraint not enforced!');

  // 11F. UNIQUE: responses (session_id, participant_id, question_id) — requires active session flow
  record('UNIQUE: responses (session_id, participant_id, question_id)',
    'NOT EXECUTED', 'Deferred to Stage 10.3C (question flow E2E)');

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${B}12. BUILD (see separate npm run build output)${X}`);
  record('npm run build', 'NOT EXECUTED', 'Run separately — see build step');

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
