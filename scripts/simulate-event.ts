import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Standard logging colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const YELLOW = '\x1b[33m';

// 1. Load env variables manually from .env.local
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const match = line.match(/^\s*([^#\s=]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1];
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    });
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  console.error(`${RED}Missing required Supabase environment keys in .env.local${RESET}`);
  process.exit(1);
}

// Clients setup
const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const NUM_PARTICIPANTS = Number(process.argv[2]) || 100;
console.log(`Starting FYC Event Simulation Rehearsal for ${YELLOW}${NUM_PARTICIPANTS}${RESET} concurrent users...\n`);

async function runSimulation() {
  const metrics = {
    authSetupDurationMs: 0,
    registrationDurationMs: 0,
    answeringDurationMs: 0,
    matchingDurationMs: 0,
    revealDurationMs: 0,
    verificationDurationMs: 0,
    chatDurationMs: 0,
    totalVerifiedCrews: 0,
  };

  // 1. Create a live simulation active session
  console.log('1. Setting up simulation session...');
  const { data: session, error: sessionErr } = await adminClient
    .from('activity_sessions')
    .insert({
      name: `Rehearsal Cohort ${NUM_PARTICIPANTS} Session`,
      status: 'LOBBY',
    })
    .select()
    .single();

  if (sessionErr || !session) {
    console.error(`${RED}Failed to create session:${RESET}`, sessionErr);
    process.exit(1);
  }
  console.log(`✓ Session created: [${session.id}] "${session.name}"`);

  // 2. Setup mock questions if missing
  const { data: existingQ } = await adminClient.from('questions').select('id').limit(5);
  if (!existingQ || existingQ.length < 5) {
    console.log('Inserting default orientation scenarios into DB...');
    for (let i = 1; i <= 5; i++) {
      const { data: q } = await adminClient
        .from('questions')
        .insert({
          question_number: i,
          question_text: `Scenario Question #${i}: System load simulation test.`,
          weight: 1.0,
        })
        .select()
        .single();
      
      if (q) {
        await adminClient.from('options').insert([
          { question_id: q.id, option_letter: 'A', option_text: 'Option A details' },
          { question_id: q.id, option_letter: 'B', option_text: 'Option B details' },
          { question_id: q.id, option_letter: 'C', option_text: 'Option C details' },
          { question_id: q.id, option_letter: 'D', option_text: 'Option D details' },
        ]);
      }
    }
  }

  const { data: questionsList } = await adminClient
    .from('questions')
    .select('id, question_number')
    .order('question_number', { ascending: true });

  // 3. Create or fetch Auth test users
  console.log(`2. Authenticating ${NUM_PARTICIPANTS} synthetic user accounts...`);
  const authStart = Date.now();
  const clients: any[] = [];

  // Create accounts in parallel chunks of 20 to avoid rate-limiting
  const batchSize = 20;
  for (let i = 0; i < NUM_PARTICIPANTS; i += batchSize) {
    const chunk = Array.from({ length: Math.min(batchSize, NUM_PARTICIPANTS - i) }, (_, idx) => i + idx);
    await Promise.all(
      chunk.map(async (num) => {
        const email = `fyc-synthetic-student-${num}-${session.id.substring(0, 8)}@appirates-orientation.com`;
        const password = 'TestUserPassword123!';

        // Check if user exists in auth schema
        let authUser: any = null;
        const { data: existingUser } = await adminClient.auth.admin.listUsers();
        const found = existingUser?.users.find(u => u.email === email);
        
        if (found) {
          authUser = found;
        } else {
          const { data } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          });
          authUser = data?.user;
        }

        if (authUser) {
          const userClient = createClient(supabaseUrl as string, supabaseAnonKey as string, {
            auth: { persistSession: false, autoRefreshToken: false }
          });
          const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
          if (!signInError) {
            clients.push({ id: authUser.id, name: `Student-${num}`, client: userClient });
          }
        }
      })
    );
  }
  metrics.authSetupDurationMs = Date.now() - authStart;
  console.log(`✓ Authenticated ${clients.length} clients in ${metrics.authSetupDurationMs} ms.`);

  // 4. Registration phase
  console.log(`3. Registering profiles concurrently...`);
  const regStart = Date.now();
  await Promise.all(
    clients.map(async (student, idx) => {
      // Upsert profile
      const { error: profileError } = await student.client.from('participants').upsert({
        id: student.id,
        full_name: student.name,
        email: `fyc-synthetic-student-${idx}-${session.id.substring(0, 8)}@appirates-orientation.com`,
        phone: '1234567890',
        branch: idx % 2 === 0 ? 'Computer Science' : 'Electronics',
        year: (idx % 4) + 1,
        consent_status: true,
      });

      if (profileError) {
        console.error(`Profile upsert error for ${student.name}:`, profileError.message);
      }

      // Insert session participant relation
      if (!profileError) {
        const { error: spError } = await student.client.from('session_participants').insert({
          session_id: session.id,
          participant_id: student.id,
          status: 'REGISTERED',
        });
        if (spError) {
          console.error(`Session registration error for ${student.name}:`, spError.message);
        }
      }
    })
  );
  metrics.registrationDurationMs = Date.now() - regStart;
  console.log(`✓ Registered ${clients.length} profiles in ${metrics.registrationDurationMs} ms.`);

  // 5. Answering Questions phase
  console.log(`4. Simulating Q1..Q5 response submissions...`);
  const answerStart = Date.now();
  const optionsLetters: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];

  for (const q of questionsList!) {
    // Admin sets question timer started
    await adminClient
      .from('activity_sessions')
      .update({
        status: `QUESTION_${q.question_number}`,
        current_question_id: q.id,
        timer_started_at: new Date().toISOString(),
        timer_duration: 30,
      })
      .eq('id', session.id);

    // Concurrent answer submits (everyone answers A, B, C, or D deterministically based on index)
    await Promise.all(
      clients.map(async (student, idx) => {
        const choice = optionsLetters[idx % 4];
        await student.client.from('responses').insert({
          session_id: session.id,
          participant_id: student.id,
          question_id: q.id,
          selected_option: choice,
        });
      })
    );
  }
  metrics.answeringDurationMs = Date.now() - answerStart;
  console.log(`✓ Submitted ${clients.length * 5} answers in ${metrics.answeringDurationMs} ms.`);

  // 6. Registration Lock & Matching
  console.log(`5. Locking registration and running Matching Engine...`);
  const matchStart = Date.now();
  
  // 5. Calculate matches using server matching engine (persists groups and sets status to MATCHING)
  const { runMatchingEngine } = require('../lib/matching/engine');
  const res = await runMatchingEngine(session.id, adminClient);
  
  metrics.matchingDurationMs = Date.now() - matchStart;
  
  if (!res.success) {
    console.error(`${RED}Matching calculation failed:${RESET}`, res.error);
    process.exit(1);
  }
  console.log(`✓ Matching completed in ${metrics.matchingDurationMs} ms. Standbys: ${res.auditLog.numStandby}. Crews: ${res.auditLog.groupCount}.`);

  // Transition session status to GROUP_REVEAL via safe RPC transition locking
  const { data: matchResult, error: matchError } = await adminClient.rpc('transition_session_status', {
    p_session_id: session.id,
    p_target_status: 'GROUP_REVEAL',
    p_question_id: null,
    p_expected_current_statuses: ['MATCHING'],
  });

  if (matchError || !matchResult) {
    console.error(`${RED}Failed to transition session state to GROUP_REVEAL:${RESET}`, matchError);
    process.exit(1);
  }

  // 7. Group Reveal & Crew check-ins
  console.log(`6. Simulating physical crew check-ins...`);
  const revealStart = Date.now();

  // Fetch all groups created
  const { data: groups } = await adminClient
    .from('groups')
    .select('id, group_code')
    .eq('session_id', session.id);

  console.log(`Matching generated ${groups?.length} groups.`);

  // Concurrent verification check-in triggers
  if (groups) {
    await Promise.all(
      clients.map(async (student) => {
        // Query group membership for student
        const { data: memberOf } = await student.client
          .from('group_members')
          .select('group_id')
          .eq('participant_id', student.id)
          .maybeSingle();

        if (memberOf) {
          const groupDetails = groups.find(g => g.id === memberOf.group_id);
          if (groupDetails) {
            // Update check-in flag (triggers atomic postgres checks)
            await student.client
              .from('group_members')
              .update({
                is_checked_in: true,
                checked_in_at: new Date().toISOString(),
              })
              .eq('group_id', groupDetails.id)
              .eq('participant_id', student.id);
          }
        }
      })
    );
  }
  metrics.verificationDurationMs = Date.now() - revealStart;

  // Confirm check-ins counts
  const { data: verifiedCount } = await adminClient
    .from('groups')
    .select('id')
    .eq('session_id', session.id)
    .eq('is_verified', true);
  
  metrics.totalVerifiedCrews = verifiedCount?.length || 0;
  console.log(`✓ Crews verification completed. Verified: ${metrics.totalVerifiedCrews} / ${groups?.length} crews in ${metrics.verificationDurationMs} ms.`);

  // 8. Group Chat Simulation
  console.log(`7. Simulating group chat messages feed...`);
  const chatStart = Date.now();

  // Admin transitions state to GROUP_CHAT
  await adminClient
    .from('activity_sessions')
    .update({ status: 'GROUP_CHAT' })
    .eq('id', session.id);

  // Send concurrent greetings
  if (groups) {
    await Promise.all(
      clients.slice(0, 40).map(async (student) => {
        const { data: memberOf } = await student.client
          .from('group_members')
          .select('group_id')
          .eq('participant_id', student.id)
          .maybeSingle();

        if (memberOf) {
          const { data: group } = await student.client
            .from('groups')
            .select('is_verified')
            .eq('id', memberOf.group_id)
            .single();

          if (group && group.is_verified) {
            await student.client.from('chat_messages').insert({
              group_id: memberOf.group_id,
              sender_id: student.id,
              message_text: `Simulation test greeting from ${student.name}`,
            });
          }
        }
      })
    );
  }
  metrics.chatDurationMs = Date.now() - chatStart;
  console.log(`✓ Chat message broadcast simulation complete in ${metrics.chatDurationMs} ms.`);

  // 9. Cleanup session & test records
  console.log('8. Archiving simulation session...');
  await adminClient
    .from('activity_sessions')
    .update({ status: 'ARCHIVED' })
    .eq('id', session.id);

  console.log(`\n${GREEN}SIMULATION COMPLETED SUCCESSFULLY FOR ${NUM_PARTICIPANTS} USERS!${RESET}`);
  console.log('----------------------------------------------------');
  console.log(`Auth setup latency:       ${metrics.authSetupDurationMs} ms`);
  console.log(`Profile registration:     ${metrics.registrationDurationMs} ms`);
  console.log(`Scenario response feeds:  ${metrics.answeringDurationMs} ms`);
  console.log(`Matching calculations:    ${metrics.matchingDurationMs} ms`);
  console.log(`Reveal & Verification:    ${metrics.verificationDurationMs} ms`);
  console.log(`Crew chat broadcasts:     ${metrics.chatDurationMs} ms`);
  console.log(`Crews verified count:     ${metrics.totalVerifiedCrews} crews`);
  console.log('----------------------------------------------------');
}

runSimulation().catch(err => {
  console.error(`${RED}Simulation script crashed:${RESET}`, err);
  process.exit(1);
});
