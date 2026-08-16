/**
 * Apply the response immutability RLS patch to staging via the Supabase REST API,
 * then re-run immutability tests to confirm the fix.
 * NEVER prints secret keys.
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
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[34m', X = '\x1b[0m';

function record(key: string, pass: boolean, note = '') {
  console.log(`  ${pass ? G + 'PASS' : R + 'FAIL'}${X}  ${key}${note ? `  — ${note}` : ''}`);
  return pass;
}

const svc: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function applyPatch(sql: string): Promise<boolean> {
  // Try via Supabase management API
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
    const json = await resp.json();
    if (resp.ok) return true;
    console.log(`  Management API response:`, JSON.stringify(json).substring(0, 200));
    return false;
  } catch (e) {
    return false;
  }
}

async function main() {
  console.log(`\n${B}═══════════════════════════════════════════════════════════${X}`);
  console.log(`${B}  APPLYING RESPONSE IMMUTABILITY RLS PATCH                  ${X}`);
  console.log(`${B}═══════════════════════════════════════════════════════════${X}\n`);

  // Read migration SQL
  const patchSql = fs.readFileSync(
    'supabase/migrations/20260816000008_response_immutability_rls.sql', 'utf8'
  );

  // Apply via management API
  console.log(`${B}Applying patch via Supabase Management API...${X}`);
  const applied = await applyPatch(patchSql);
  record('Patch applied via Management API', applied);

  if (!applied) {
    console.log(`\n${R}Management API unavailable.${X}`);
    console.log(`Apply this SQL manually in Supabase Dashboard > SQL Editor:`);
    console.log(`─────────────────────────────────────────────────────────`);
    console.log(patchSql);
    console.log(`─────────────────────────────────────────────────────────`);
    console.log(`\nCannot auto-verify without patch applied. Exiting.`);
    process.exit(2); // Exit code 2 = manual action required
  }

  // ─── Re-run immutability tests ─────────────────────────────────────────────
  console.log(`\n${B}RE-RUNNING IMMUTABILITY TESTS${X}`);

  // Create a minimal test response row to test against
  const { data: sess } = await svc.from('activity_sessions')
    .insert({ name: 'FYC-IMMUTABILITY-RETEST', status: 'LOBBY' }).select('id').single();
  if (!sess) { console.error('Could not create test session'); process.exit(1); }

  // Create auth user
  const suffix = sess.id.substring(0, 8);
  const { data: authData } = await svc.auth.admin.createUser({
    email: `fyc-immut-${suffix}@staging.test`,
    password: 'FycImm10!', email_confirm: true,
  });
  const uid = authData?.user?.id;
  if (!uid) { console.error('Could not create auth user'); await svc.from('activity_sessions').delete().eq('id', sess.id); process.exit(1); }

  // Insert participant profile + register + transition + submit a response
  await svc.from('participants').upsert({
    id: uid, full_name: 'Immut Test', email: `fyc-immut-${suffix}@staging.test`,
    phone: '9876543210', branch: 'CS', year: 1, consent_status: true,
  });
  await svc.from('session_participants').insert({
    session_id: sess.id, participant_id: uid, status: 'REGISTERED',
  });
  await svc.rpc('transition_session_status', {
    p_session_id: sess.id, p_target_status: 'QUESTION_1', p_question_id: 1,
    p_expected_current_statuses: ['LOBBY'],
  });
  await svc.from('activity_sessions').update({
    timer_started_at: new Date().toISOString(), timer_duration: 60,
  }).eq('id', sess.id);

  // Insert test response via service role
  const { data: respRow } = await svc.from('responses').insert({
    session_id: sess.id, participant_id: uid, question_id: 1, selected_option: 'A',
  }).select('id').single();

  if (!respRow) { console.error('Could not create test response'); process.exit(1); }

  // Test: anon cannot UPDATE
  const { error: updateErr } = await anon.from('responses')
    .update({ selected_option: 'D' }).eq('id', respRow.id);
  record('Anon cannot UPDATE responses (after patch)', !!updateErr,
    updateErr ? `blocked: ${updateErr.code}` : 'STILL ALLOWED — patch did not apply');

  // Test: anon cannot DELETE
  const { error: deleteErr } = await anon.from('responses')
    .delete().eq('id', respRow.id);
  record('Anon cannot DELETE responses (after patch)', !!deleteErr,
    deleteErr ? `blocked: ${deleteErr.code}` : 'STILL ALLOWED — patch did not apply');

  // Verify original row still intact
  const { data: afterRow } = await svc.from('responses')
    .select('selected_option').eq('id', respRow.id).single();
  record('Original response remains A after retest', afterRow?.selected_option === 'A',
    `selected_option=${afterRow?.selected_option}`);

  // Cleanup
  await svc.from('activity_sessions').delete().eq('id', sess.id);
  await svc.auth.admin.deleteUser(uid);
  console.log(`\n  Cleanup complete.`);

  const allPassed = !!updateErr && !!deleteErr && afterRow?.selected_option === 'A';
  console.log(`\n${allPassed ? G + '✓ Immutability patch VERIFIED' : R + '✗ Patch FAILED — apply manually'}${X}\n`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
