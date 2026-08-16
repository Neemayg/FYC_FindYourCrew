import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'FYC — Find Your Crew',
  description: 'An interactive, real-time orientation experience for Appirates.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
        <div className="relative min-h-screen flex flex-col justify-between overflow-x-hidden">
          {/* Subtle global gradient background glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[400px] bg-gradient-to-b from-indigo-950/20 to-transparent blur-3xl pointer-events-none -z-10" />
          
          <main className="flex-grow flex flex-col">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
