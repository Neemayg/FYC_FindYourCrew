'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Compass } from 'lucide-react';
import { registerParticipant } from './actions';

interface RegisterFormProps {
  user: {
    id: string;
    email: string;
    fullName: string;
  };
  sessionId: string;
  sessionName: string;
  sessionStatus: string;
}

export default function RegisterForm({
  user,
  sessionId,
  sessionName,
  sessionStatus,
}: RegisterFormProps) {
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState('');
  const [branch, setBranch] = useState('Computer Science');
  const [year, setYear] = useState('1');
  const [consent, setConsent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Frontend validations
    const phoneRegex = /^\+?[0-9]{10,15}$/;
    if (!phoneRegex.test(phone.replace(/\s+/g, ''))) {
      setErrorMsg('Invalid phone number. Must contain 10 to 15 digits.');
      return;
    }

    if (!consent) {
      setErrorMsg('You must agree to share details with your crew.');
      return;
    }

    setIsLoading(true);
    setLoadingText('Creating your FYC profile...');

    try {
      // Small simulated delay for visual step transitions
      await new Promise((r) => setTimeout(r, 600));
      setLoadingText('Joining the FYC session...');

      const result = await registerParticipant({
        fullName,
        phone,
        branch,
        year: parseInt(year),
        consent,
        sessionId,
      });

      if (result.success) {
        window.location.href = '/student/waiting';
      } else {
        setErrorMsg(result.error ?? 'An unexpected error occurred. Please try again.');
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Registration dispatch failed:', err);
      setErrorMsg('Network error. Unable to contact registration server.');
      setIsLoading(false);
    }
  };

  return (
    <Card className="max-w-md w-full border-zinc-800 bg-zinc-950/40">
      <CardHeader className="border-b border-zinc-850 pb-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-900/30 rounded-lg text-indigo-400">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-100">Student Profile</h2>
            <p className="text-xs text-zinc-500">Register for: {sessionName}</p>
          </div>
        </div>
        <Badge variant="info">{sessionStatus}</Badge>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {errorMsg && (
            <div className="p-4 bg-red-950/20 border border-red-950/30 rounded-xl text-red-400 text-sm font-medium">
              {errorMsg}
            </div>
          )}

          <Input
            label="Full Name"
            placeholder="e.g. John Doe"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={isLoading}
          />

          <Input
            label="Gmail Address"
            type="email"
            readOnly
            disabled
            value={user.email}
            helperText="Authenticated via Google OAuth"
            className="opacity-60 bg-zinc-900 border-zinc-800 cursor-not-allowed select-none"
          />

          <Input
            label="Phone Number"
            placeholder="e.g. +91 9876543210"
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={isLoading}
          />

          <div className="mb-4">
            <label className="block text-zinc-300 text-sm font-medium mb-2">
              Branch / Major
            </label>
            <select
              className="w-full px-4 py-3 bg-zinc-950 text-zinc-100 rounded-xl border border-zinc-800 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/30 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={isLoading}
            >
              <option value="Computer Science">Computer Science</option>
              <option value="Information Technology">Information Technology</option>
              <option value="Electronics & Communication">Electronics & Communication</option>
              <option value="Electrical & Electronics">Electrical & Electronics</option>
              <option value="Mechanical Engineering">Mechanical Engineering</option>
              <option value="Civil Engineering">Civil Engineering</option>
              <option value="Other Major">Other Major</option>
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-zinc-300 text-sm font-medium mb-2">
              Year of Study
            </label>
            <select
              className="w-full px-4 py-3 bg-zinc-950 text-zinc-100 rounded-xl border border-zinc-800 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/30 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              disabled={isLoading}
            >
              <option value="1">1st Year</option>
              <option value="2">2nd Year</option>
              <option value="3">3rd Year</option>
              <option value="4">4th Year</option>
              <option value="5">5th Year</option>
            </select>
          </div>

          <div className="flex items-start gap-3 mt-6 p-4 bg-zinc-900/30 rounded-xl border border-zinc-900">
            <input
              id="consent"
              type="checkbox"
              required
              className="mt-1 h-4 w-4 rounded border-zinc-800 bg-zinc-950 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={isLoading}
            />
            <label
              htmlFor="consent"
              className="text-xs text-zinc-400 leading-relaxed cursor-pointer select-none"
            >
              I consent to share my name and details with other members of my matched group to facilitate orientation coordination.
            </label>
          </div>
        </CardContent>

        <div className="mt-8 flex flex-col gap-4">
          <Button
            type="submit"
            variant="primary"
            fullWidth
            isLoading={isLoading}
          >
            {isLoading ? loadingText : 'Register and Join FYC'}
          </Button>
          
          <Link
            href="/"
            className="text-xs text-zinc-650 hover:text-zinc-550 text-center block"
          >
            Cancel and disconnect
          </Link>
        </div>
      </form>
    </Card>
  );
}
