import { NextResponse } from 'next/server';
import { aiConfig } from '@/ai/config';

export const dynamic = 'force-dynamic';

export function GET() {
  const c = aiConfig();
  // Only booleans and the model id are exposed — never the key.
  return NextResponse.json({ ai: c.hasKey, model: c.hasKey ? c.model : undefined, liveData: process.env.LD_ENABLE_LIVE_DATA === '1' });
}
