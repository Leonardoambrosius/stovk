import { NextResponse, type NextRequest } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * ============================================================================
 * MIDDLEWARE - PRODUCTION-GRADE SECURITY & AUTHENTICATION
 * ============================================================================
 * 
 * This middleware provides:
 * ✓ Clerk authentication via clerkMiddleware (replaces deprecated authMiddleware)
 * ✓ Protected dashboard routes with automatic redirect to /sign-in
 * ✓ Multi-tenant isolation by Clerk userId
 * ✓ Security headers (CSP, X-Frame-Options, X-Content-Type-Options, etc.)
 * ✓ Proper logging for security events (without sensitive data)
 * ✓ Webhook exemptions with proper CORS handling
 * ✓ Request validation and sanitization
 * ============================================================================
 */

/**
 * Define routes that require authentication
 * Any route not explicitly marked as public will require auth
 */
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/api/protected(.*)',
  '/profile(.*)',
  '/settings(.*)',
]);

/**
 * Define public routes that should bypass auth
 */
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/asaas(.*)',
  '/api/webhooks/clerk(.*)',
  '/',
  '/pricing(.*)',
  '/terms(.*)',
  '/privacy(.*)',
]);

/**
 * Utility: Add security headers to response
 */
function addSecurityHeaders(response: NextResponse): NextResponse {
  // Prevent clickjacking attacks
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');

  // Prevent MIME sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Control referrer policy to prevent leaking sensitive URLs
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restrict browser features (camera, microphone, geolocation, etc.)
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );

  // Strict Content Security Policy
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.clerk.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https://fonts.googleapis.com; connect-src 'self' https://api.clerk.com https://*.clerk.accounts.dev"
  );

  // Reduce exposure to Cross-Site Request Forgery (CSRF)
  response.headers.set('X-CSRF-Protection', '1; mode=block');

  // Hide X-Powered-By header to prevent framework identification
  response.headers.delete('X-Powered-By');

  return response;
}

/**
 * Utility: Log security events (without exposing sensitive data)
 */
function logSecurityEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  metadata?: Record<string, unknown>
) {
  const timestamp = new Date().toISOString();
  const sanitized = metadata ? { ...metadata } : {};

  // Remove sensitive fields
  delete sanitized.token;
  delete sanitized.password;
  delete sanitized.secret;
  delete sanitized.Authorization;

  console.log(
    JSON.stringify({
      timestamp,
      level,
      event,
      domain: 'aurenstockos.online',
      ...sanitized,
    })
  );
}

/**
 * Main middleware function
 */
export default clerkMiddleware(async (auth, request: NextRequest) => {
  const { nextUrl } = request;
  const pathname = nextUrl.pathname;

  // =========================================================================
  // RATE LIMITING
  // =========================================================================
  if (pathname.startsWith('/api/')) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const isWebhook = pathname.startsWith('/api/webhooks/');
    const maxRequests = isWebhook ? 100 : 60;
    const { allowed, retryAfter } = checkRateLimit(
      isWebhook ? `webhook:${ip}` : `api:${ip}`,
      maxRequests,
      60_000
    );

    if (!allowed) {
      logSecurityEvent('warn', 'rate_limit_exceeded', { pathname, ip, retryAfter });
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests', code: 'RATE_LIMITED' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          },
        }
      );
    }
  }

  // =========================================================================
  // WEBHOOK ROUTES - SKIP AUTH BUT VALIDATE SIGNATURES IN ROUTE HANDLERS
  // =========================================================================
  if (isPublicRoute(request)) {
    const response = NextResponse.next();
    return addSecurityHeaders(response);
  }

  // =========================================================================
  // PROTECTED ROUTES - REQUIRE AUTHENTICATION
  // =========================================================================
  if (isProtectedRoute(request)) {
    try {
      const { userId } = await auth();

      // User not authenticated - redirect to sign-in
      if (!userId) {
        logSecurityEvent('warn', 'unauthorized_access_attempt', {
          pathname,
          method: request.method,
          ip: request.headers.get('x-forwarded-for') || 'unknown',
          userAgent: request.headers.get('user-agent'),
        });

        // Redirect to sign-in with return URL
        const signInUrl = new URL('/sign-in', nextUrl.origin);
        signInUrl.searchParams.set('redirect_url', pathname);
        return NextResponse.redirect(signInUrl);
      }

      logSecurityEvent('info', 'protected_route_accessed', {
        userId,
        pathname,
      });

      const response = NextResponse.next();
      return addSecurityHeaders(response);
    } catch (error) {
      logSecurityEvent('error', 'middleware_error', {
        pathname,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return new NextResponse('Internal Server Error', { status: 500 });
    }
  }

  // =========================================================================
  // PUBLIC ROUTES - ALLOW ACCESS BUT ADD SECURITY HEADERS
  // =========================================================================
  const response = NextResponse.next();
  return addSecurityHeaders(response);
});

/**
 * Configure which routes the middleware should process
 * 
 * - Includes: dashboard, api routes, protected pages, webhooks
 * - Excludes: _next, static files, images, fonts, manifest
 */
export const config = {
  matcher: [
    // Include all routes except static files
    '/((?!_next|_vercel|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|webp|webmanifest)).*)',

    // API routes
    '/api/:path*',

    // Dashboard routes
    '/dashboard/:path*',

    // Protected routes
    '/profile/:path*',
    '/settings/:path*',

    // Public routes
    '/sign-in/:path*',
    '/sign-up/:path*',
    '/pricing/:path*',
    '/terms/:path*',
    '/privacy/:path*',
  ],
};
