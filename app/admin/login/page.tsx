'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Lock, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);

    const supabase = createClient();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        setIsLoading(false);
        return;
      }

      // Check if user has admin app metadata role
      const user = data?.user;
      if (!user || user.app_metadata?.role !== 'admin') {
        setErrorMsg('Access denied. Administrator role credentials required.');
        await supabase.auth.signOut();
        setIsLoading(false);
        return;
      }

      // Redirect on successful admin auth
      window.location.href = '/admin/dashboard';
    } catch (err: any) {
      console.error(err);
      setErrorMsg('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-grow flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40">
        <CardHeader className="border-b border-zinc-850 pb-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-950/30 rounded-lg text-red-400">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-100">FYC Control Room</h2>
              <p className="text-xs text-zinc-500">Administrator Credentials Required</p>
            </div>
          </div>
          <Badge variant="danger">Restricted</Badge>
        </CardHeader>

        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            {errorMsg && (
              <div className="p-3 bg-red-950/30 border border-red-900/30 text-red-400 text-sm rounded-lg flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <Input
              label="Admin Email"
              type="email"
              placeholder="operator@appirates.club"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <Input
              label="Secret Passcode"
              type="password"
              placeholder="••••••••••••"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </CardContent>

          <div className="mt-8 flex flex-col gap-4">
            <Button
              type="submit"
              variant="danger"
              fullWidth
              isLoading={isLoading}
            >
              Access Control Console
            </Button>
            
            <Link
              href="/"
              className="text-xs text-zinc-500 hover:text-zinc-400 text-center block"
            >
              Back to landing page
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
