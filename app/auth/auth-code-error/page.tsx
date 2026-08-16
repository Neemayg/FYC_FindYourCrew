import React from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';

export default function AuthCodeErrorPage() {
  return (
    <div className="flex-grow flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40 text-center py-10">
        <CardHeader className="flex flex-col items-center justify-center mb-6">
          <div className="h-16 w-16 bg-red-950/40 rounded-full flex items-center justify-center text-red-400 mb-4 border border-red-900/30">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <h2 className="text-2xl font-extrabold text-zinc-100 tracking-tight">
            Authentication Error
          </h2>
          <p className="text-xs text-zinc-500 mt-1">FYC — Find Your Crew</p>
        </CardHeader>

        <CardContent className="space-y-6">
          <p className="text-zinc-400 font-light max-w-sm mx-auto leading-relaxed">
            The Google authorization exchange failed. This can happen if the login session expired, credentials configuration is pending, or network issues occurred.
          </p>

          <div className="flex justify-center gap-2">
            <Badge variant="danger">Auth Status: Failed</Badge>
          </div>
        </CardContent>

        <div className="mt-8">
          <Link
            href="/"
            className="px-6 py-2.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-200 font-semibold rounded-xl transition-all duration-300 text-sm"
          >
            Try Again
          </Link>
        </div>
      </Card>
    </div>
  );
}
