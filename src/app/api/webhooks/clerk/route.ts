import { NextResponse, type NextRequest } from 'next/server';
import { prisma, withDatabaseErrorHandling } from '../../../../lib/prisma';
import { verifySvixSignature } from '../../../../lib/svix';

/**
 * ============================================================================
 * CLERK USER MANAGEMENT WEBHOOK - PRODUCTION-GRADE SECURITY
 * ============================================================================
 * 
 * This endpoint listens for Clerk user creation events and provisions
 * a new tenant (Empresa) and user record automatically.
 * 
 * Security measures:
 * ✓ Validates webhook signature using CLERK_WEBHOOK_SECRET
 * ✓ Idempotent: prevents duplicate user provisioning
 * ✓ Proper error logging without exposing sensitive data
 * ✓ Returns appropriate HTTP status codes
 * ✓ Validates extracted data before database operations
 * ============================================================================
 */

/**
 * Utility: Log webhook events
 */
function logWebhookEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  metadata?: Record<string, unknown>
) {
  const timestamp = new Date().toISOString();
  const sanitized = metadata ? { ...metadata } : {};

  // Remove sensitive fields
  delete sanitized.password;
  delete sanitized.email_addresses;

  console.log(
    JSON.stringify({
      timestamp,
      level,
      webhook: 'clerk',
      event,
      ...sanitized,
    })
  );
}

/**
 * POST /api/webhooks/clerk
 * 
 * Handles Clerk user events:
 * - user.created: Provisions a new tenant and user record
 * - Other events are ignored
 */
export async function POST(request: NextRequest) {
  try {
    // =====================================================================
    // WEBHOOK SIGNATURE VERIFICATION (Svix standard)
    // =====================================================================
    const svixId = request.headers.get('svix-id');
    const svixTimestamp = request.headers.get('svix-timestamp');
    const svixSignature = request.headers.get('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      logWebhookEvent('warn', 'missing_svix_headers');
      return new NextResponse(
        JSON.stringify({ error: 'Missing Svix headers', code: 'INVALID_REQUEST' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      logWebhookEvent('error', 'webhook_secret_not_configured');
      return new NextResponse(
        JSON.stringify({ error: 'Webhook not configured', code: 'INTERNAL_ERROR' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const rawBody = await request.text();
    const payloadBuffer = Buffer.from(rawBody, 'utf-8');

    verifySvixSignature(payloadBuffer, svixSignature, secret);
    logWebhookEvent('info', 'webhook_signature_verified');

    let payload: { type: string; data?: Record<string, unknown> };

    try {
      payload = JSON.parse(rawBody);
    } catch {
      logWebhookEvent('warn', 'invalid_json_payload');
      return new NextResponse(
        JSON.stringify({ error: 'Invalid JSON', code: 'INVALID_REQUEST' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // =====================================================================
    // FILTER EVENT TYPE
    // =====================================================================
    if (payload.type !== 'user.created') {
      logWebhookEvent('info', 'event_ignored', { eventType: payload.type });
      return new NextResponse(
        JSON.stringify({ status: 'ignored', message: 'Event type not processed' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // =====================================================================
    // EXTRACT AND VALIDATE USER DATA
    // =====================================================================
    const eventData = payload.data;
    const clerkUserId = eventData?.id as string;
    const emailAddresses = eventData?.email_addresses as
      | Array<{ email_address: string }>
      | undefined;

    if (!clerkUserId || typeof clerkUserId !== 'string') {
      logWebhookEvent('warn', 'missing_clerk_user_id');

      return new NextResponse(
        JSON.stringify({
          error: 'Missing user ID',
          code: 'INVALID_REQUEST',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const email = Array.isArray(emailAddresses)
      ? emailAddresses[0]?.email_address
      : undefined;

    if (!email || typeof email !== 'string') {
      logWebhookEvent('warn', 'missing_user_email', {
        clerkUserId,
        hasEmailAddresses: !!emailAddresses,
      });

      return new NextResponse(
        JSON.stringify({
          error: 'Missing user email',
          code: 'INVALID_REQUEST',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    logWebhookEvent('info', 'user_creation_initiated', {
      clerkUserId,
    });

    // =====================================================================
    // IDEMPOTENCY CHECK
    // =====================================================================
    const existing = await withDatabaseErrorHandling(
      () =>
        prisma.usuario.findUnique({
          where: { id: clerkUserId },
        }),
      'clerkWebhook.findExistingUser'
    );

    if (existing) {
      logWebhookEvent('info', 'user_already_exists', {
        clerkUserId,
      });

      return new NextResponse(
        JSON.stringify({
          status: 'already_exists',
          userId: clerkUserId,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // =====================================================================
    // CREATE TENANT (EMPRESA)
    // =====================================================================
    const empresa = await withDatabaseErrorHandling(
      () =>
        prisma.empresa.create({
          data: {
            nome: email.split('@')[0] || 'Empresa',
            plano: 'FREE',
            limite_produtos: 50,
            ativo: true,
          },
          select: {
            id: true,
            nome: true,
          },
        }),
      'clerkWebhook.createEmpresa'
    );

    logWebhookEvent('info', 'empresa_created', {
      clerkUserId,
      empresaId: empresa.id,
    });

    // =====================================================================
    // CREATE USER RECORD
    // =====================================================================
    const usuario = await withDatabaseErrorHandling(
      () =>
        prisma.usuario.create({
          data: {
            id: clerkUserId,
            email,
            empresa_id: empresa.id,
            role: 'ADMIN', // First user is admin
          },
          select: {
            id: true,
            email: true,
            empresa_id: true,
          },
        }),
      'clerkWebhook.createUsuario'
    );

    logWebhookEvent('info', 'usuario_created', {
      clerkUserId: usuario.id,
      empresaId: usuario.empresa_id,
    });

    return new NextResponse(
      JSON.stringify({
        status: 'provisioned',
        userId: usuario.id,
        empresaId: usuario.empresa_id,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logWebhookEvent('error', 'provisioning_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    // Return 200 to acknowledge receipt, but log error for monitoring
    return new NextResponse(
      JSON.stringify({
        error: 'Provisioning failed',
        code: 'INTERNAL_ERROR',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Allowed origin for Clerk webhook requests
 */
const CLERK_ORIGIN = 'https://clerk.com';

/**
 * Validate that the request originates from Clerk
 */
function validateOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  return origin === CLERK_ORIGIN || (!!referer && referer.startsWith(CLERK_ORIGIN));
}

/**
 * OPTIONS request handler (CORS support for pre-flight requests)
 */
export async function OPTIONS(request: NextRequest) {
  if (!validateOrigin(request)) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': CLERK_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, svix-id, svix-timestamp, svix-signature',
    },
  });
}

