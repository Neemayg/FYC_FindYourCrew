'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Compass, Users, Sparkles, Code2, LogIn } from 'lucide-react';

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [sessionUrl, setSessionUrl] = useState('/student/register');

  useEffect(() => {
    // Determine redirect path after callback login
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const nextPath = params.get('next');
      if (nextPath) {
        setSessionUrl(nextPath);
      }
    }
  }, []);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    const supabase = createClient();
    
    // Resolve absolute redirect URI
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(sessionUrl)}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
    });

    if (error) {
      console.error('OAuth configuration error:', error.message);
      setIsLoading(false);
      // Redirect to code error page if login fails
      window.location.href = `/auth/auth-code-error`;
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[90vh] px-4 py-12 relative">
      <div className="text-center max-w-2xl mx-auto mb-16">
        <Badge variant="info" className="mb-4">
          Appirates Orientation Day
        </Badge>
        
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-zinc-100 via-indigo-200 to-indigo-400 mb-6 leading-tight">
          FIND YOUR CREW
        </h1>
        
        <p className="text-lg md:text-xl text-zinc-400 font-light mb-8 max-w-xl mx-auto leading-relaxed">
          Orientation is not a lecture. It is a live, real-time cooperative experience. Discover compatible builders and form your cohort.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto w-full">
          <Button
            variant="primary"
            className="w-full sm:w-auto px-8 py-3.5 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25"
            isLoading={isLoading}
            onClick={handleGoogleLogin}
          >
            <LogIn className="h-5 w-5" />
            Continue with Google
          </Button>
          <Link
            href="/admin/login"
            className="w-full sm:w-auto px-8 py-3.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 font-semibold rounded-xl transition-all duration-300 text-center text-sm"
          >
            Control Console
          </Link>
        </div>
      </div>

      {/* Concept Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl w-full mx-auto">
        <Card hoverEffect>
          <CardHeader>
            <Compass className="h-6 w-6 text-indigo-400" />
            <Badge variant="zinc">Pillar 1</Badge>
          </CardHeader>
          <h3 className="text-zinc-200 font-bold text-lg mb-2">Curiosity</h3>
          <CardContent>
            Explore scenarios and lock in choices. Your responses reveal how you navigate and solve design problems.
          </CardContent>
        </Card>

        <Card hoverEffect>
          <CardHeader>
            <Users className="h-6 w-6 text-indigo-400" />
            <Badge variant="zinc">Pillar 2</Badge>
          </CardHeader>
          <h3 className="text-zinc-200 font-bold text-lg mb-2">Connection</h3>
          <CardContent>
            Get matched with exactly three compatible peers. Break the ice and discover the builders around you.
          </CardContent>
        </Card>

        <Card hoverEffect>
          <CardHeader>
            <Sparkles className="h-6 w-6 text-indigo-400" />
            <Badge variant="zinc">Pillar 3</Badge>
          </CardHeader>
          <h3 className="text-zinc-200 font-bold text-lg mb-2">Collaboration</h3>
          <CardContent>
            Assemble your crew physically. Verify your coordinates to unlock your private ephemeral chat.
          </CardContent>
        </Card>

        <Card hoverEffect>
          <CardHeader>
            <Code2 className="h-6 w-6 text-indigo-400" />
            <Badge variant="zinc">Pillar 4</Badge>
          </CardHeader>
          <h3 className="text-zinc-200 font-bold text-lg mb-2">Building Together</h3>
          <CardContent>
            Start your Appirates journey. Connect, collaborate, and design the future of technical builds.
          </CardContent>
        </Card>
      </div>

      <footer className="absolute bottom-4 text-xs text-zinc-650 text-center w-full">
        Appirates Club orientation experience. Stage 2 Project Foundation.
      </footer>
    </div>
  );
}
