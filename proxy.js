import { NextResponse } from 'next/server';
import traffic from './lib/traffic';

// Records page and asset requests into the live access log that the log audit
// reads (/api/audit/live). API requests are recorded by the API handler itself,
// with their real status and size, so they are skipped here.
export function proxy(request) {
  try {
    const h = request.headers;
    traffic.record({
      ip: String(h.get('x-forwarded-for') || h.get('x-real-ip') || '').split(',')[0].trim() || 'unknown',
      method: request.method,
      path: request.nextUrl.pathname + request.nextUrl.search,
      status: 0,
      bytes: 0,
      ua: h.get('user-agent') || '',
    });
  } catch { /* logging never blocks a page */ }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/).*)'],
};
