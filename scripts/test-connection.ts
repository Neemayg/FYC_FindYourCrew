import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

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

console.log('--- SUPABASE ENVIRONMENT AUDIT ---');
console.log(`SUPABASE_URL: ${supabaseUrl ? GREEN + 'CONFIGURED' : RED + 'MISSING'}${RESET}`);
console.log(`PUBLIC_KEY:   ${supabaseAnonKey ? GREEN + 'CONFIGURED' : RED + 'MISSING'}${RESET}`);
console.log(`SERVICE_ROLE: ${supabaseServiceKey ? GREEN + 'CONFIGURED' : RED + 'MISSING'}${RESET}`);
console.log('----------------------------------\n');

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const tables = [
  'activity_sessions',
  'participants',
  'session_participants',
  'questions',
  'options',
  'responses',
  'groups',
  'group_members',
  'chat_messages'
];

async function checkDatabase() {
  console.log('Checking staging database tables presence...');
  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (error) {
      console.log(`- Table ${YELLOW}${table}${RESET}: ${RED}FAILED${RESET} (Error: ${error.message})`);
    } else {
      console.log(`- Table ${YELLOW}${table}${RESET}: ${GREEN}PRESENCE VALIDATED${RESET}`);
    }
  }
}

checkDatabase().catch(err => {
  console.error('Diagnostic run crashed:', err);
  process.exit(1);
});
