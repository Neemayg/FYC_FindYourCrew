import { createBrowserClient } from '@supabase/ssr';

/**
 * Creates a Supabase client for use in Browser/Client Components.
 */
export const createClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Provide a safe fallback or warnings for early development if variables aren't set yet
    console.warn('Supabase credentials are not set in environment variables.');
  }

  return createBrowserClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder-key'
  );
};
