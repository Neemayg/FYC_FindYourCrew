import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Endpoint called by Supabase Auth after successful Google OAuth redirection.
 * Exchanges authorization code for an active student session cookie.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/student/register';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error) {
      // Safely forward to the target path (e.g. register or waiting room)
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Redirect to error screen if code exchange fails
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
