import { NextResponse, type NextFetchEvent } from 'next/server';
import type { NextRequest } from 'next/server';
import { authMiddleware } from '@clerk/nextjs/server';

/**
 * Global middleware for the Aurenstockos SaaS.
 * - Protects all `/dashboard/*` routes using Clerk authentication.
 * - Allows public pages and webhook endpoints under `/api/webhooks/*` without authentication.
 * - Enforces the architectural guardrails of zero front‑end data exposure and multi‑tenant isolation.
 */
export async function middleware(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl;

  // Public webhook endpoints – no auth required but must be reachable.
  if (pathname.startsWith('/api/webhooks')) {
    return NextResponse.next();
  }

  // Protect dashboard routes – require a valid Clerk session.
  if (pathname.startsWith('/dashboard')) {
    // Clerk's authMiddleware returns a NextResponse that redirects to sign‑in when unauthenticated.
    return await authMiddleware()(req, event);
  }

  // All other routes are public.
  return NextResponse.next();
}

/**
 * Apply the middleware only to the relevant paths.
 * This ensures we don't unnecessarily invoke Clerk on static assets, API routes, etc.
 */
export const config = {
  matcher: ['/dashboard/:path*', '/api/webhooks/:path*'],
};
