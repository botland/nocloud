'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export default function SuccessPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-20 h-20 bg-emerald-900/30 rounded-full flex items-center justify-center mb-8">
          <i className="fa-solid fa-check-double text-emerald-400 text-5xl"></i>
        </div>

        <h1 className="text-4xl font-semibold tracking-tighter mb-3">Order confirmed</h1>
        <p className="text-xl text-slate-400 mb-8">
          Thank you for choosing NoCloud.<br />Your private generative AI appliance is being prepared.
        </p>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 mb-8 text-left">
          <div className="flex justify-between text-sm mb-4">
            <span className="text-slate-400">Order reference</span>
            <span className="font-mono text-emerald-400">NC-{Date.now().toString().slice(-8)}</span>
          </div>
          
          {sessionId && (
            <div className="flex justify-between text-sm mb-4">
              <span className="text-slate-400">Stripe Session</span>
              <span className="font-mono text-xs break-all">{sessionId}</span>
            </div>
          )}

          <div className="pt-4 border-t border-slate-800 text-sm text-slate-400">
            You will receive a confirmation email with invoice, tracking information, and setup instructions within the next few minutes.
          </div>
        </div>

        <div className="space-y-3">
          <Link 
            href="/" 
            className="block w-full py-4 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-colors"
          >
            Back to homepage
          </Link>
          
          <a 
            href="mailto:support@nocloud.ai" 
            className="block text-sm text-slate-400 hover:text-white"
          >
            Questions? Contact our B2B team →
          </a>
        </div>

        <p className="mt-10 text-xs text-slate-500">
          European B2B • 3-year warranty • On-premise • No cloud
        </p>
      </div>
    </div>
  );
}
