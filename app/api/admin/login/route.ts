import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { rejectInvalidContentType } from '@/lib/validateRequest';
import { constantTimeEqual, createAdminSessionToken } from '@/lib/adminAuth';
import { clientIp } from '@/lib/ownership';

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`admin-login:${clientIp(req)}`, 5, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }
  const reject = rejectInvalidContentType(req);
  if (reject) return reject;

  // Malformed JSON is a 400, not the 500 an unguarded req.json() produced.
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === 'string' ? body.password : '';
  const adminPassword = process.env.ADMIN_PASSWORD;

  // constantTimeEqual, not `!==` — see lib/adminAuth. The rate limit above
  // makes a timing attack impractical anyway, but a five-line helper is cheaper
  // than relying on that being true forever.
  if (!adminPassword || !(await constantTimeEqual(password, adminPassword))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin_session', await createAdminSessionToken(adminPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 8, // 8 hours
    path: '/',
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('admin_session');
  return res;
}
