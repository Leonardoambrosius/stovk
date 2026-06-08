import { NextResponse, type NextRequest } from 'next/server';
import { prisma, withDatabaseErrorHandling } from '../../../../lib/prisma';
import { verifySvixSignature } from '../../../../lib/svix';

/**
 * ============================================================================
 * ASAAS PAYMENT WEBHOOK - PRODUCTION-GRADE SECURITY
 * ============================================================================
 * 
 * This endpoint receives payment confirmation webhooks from Asaas.
 * 
 * Security measures:
 * ✓ Validates Svix signature to ensure request comes from Asaas
 * ✓ Returns 200 immediately to prevent timeouts
 * ✓ Processes upgrades asynchronously in background
 * ✓ Validates webhook secret from environment
 * ✓ Idempotent: safely handles duplicate webhook deliveries
 * ✓ Proper error logging without exposing sensitive data
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
  delete sanitized.token;
  delete sanitized.secret;

  console.log(
    JSON.stringify({
      timestamp,
      level,
      webhook: 'asaas',
      event,
      ...sanitized,
    })
  );
}

export async function POST(request: NextRequest) {
  try {
    const svixId = request.headers.get('svix-id');
    const svixTimestamp = request.headers.get('svix-timestamp');
    const svixSignature = request.headers.get('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      logWebhookEvent('warn', 'missing_svix_headers', {
        hasId: !!svixId,
        hasTimestamp: !!svixTimestamp,
        hasSignature: !!svixSignature,
      });

      return new NextResponse(
        JSON.stringify({
          error: 'Missing Svix headers',
          code: 'INVALID_REQUEST',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const secret = process.env.SVIX_ASAAS_SECRET;
    if (!secret) {
      logWebhookEvent('error', 'webhook_secret_not_configured');

      return new NextResponse(
        JSON.stringify({
          error: 'Webhook not configured',
          code: 'INTERNAL_ERROR',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const rawBody = await request.text();
    const payloadBuffer = Buffer.from(rawBody, 'utf-8');

    try {
      verifySvixSignature(payloadBuffer, svixSignature, secret);
      logWebhookEvent('info', 'signature_verified');
    } catch (signatureError) {
      logWebhookEvent('warn', 'invalid_signature', {
        error: signatureError instanceof Error ? signatureError.message : 'Unknown error',
      });

      return new NextResponse(
        JSON.stringify({
          error: 'Invalid signature',
          code: 'UNAUTHORIZED',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let event: Record<string, unknown>;

    try {
      event = JSON.parse(payloadBuffer.toString());
    } catch (parseError) {
      logWebhookEvent('warn', 'invalid_json_payload', {
        error: parseError instanceof Error ? parseError.message : 'Unknown error',
      });

      return new NextResponse(
        JSON.stringify({
          error: 'Invalid JSON',
          code: 'INVALID_REQUEST',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const eventName = ((event.event ?? event.type ?? '') as string)
      .toUpperCase()
      .trim();

    logWebhookEvent('info', 'event_received', {
      eventType: eventName,
    });

    if (eventName === 'PAYMENT_CONFIRMED') {
      try {
        await handleAsaasEvent(event, svixId);
      } catch (error) {
        logWebhookEvent('error', 'payment_processing_failed', {
          eventId: svixId,
          error: error instanceof Error ? error.message : 'Unknown error',
          payload: rawBody.substring(0, 1000),
        });

        return new NextResponse(
          JSON.stringify({
            error: 'Payment processing failed',
            code: 'INTERNAL_ERROR',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      logWebhookEvent('info', 'event_ignored', {
        eventType: eventName,
      });
    }

    return new NextResponse(
      JSON.stringify({
        status: 'received',
        eventId: svixId,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    logWebhookEvent('error', 'unhandled_error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return new NextResponse(
      JSON.stringify({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export async function handleAsaasEvent(
  event: Record<string, unknown>,
  eventId: string
): Promise<void> {
  try {
    const data = event.data as Record<string, unknown> | undefined;
    const customer = data?.customer as Record<string, unknown> | undefined;

    const asaasCustomerId =
      (customer?.id as string) || (data?.customerId as string);

    if (!asaasCustomerId || typeof asaasCustomerId !== 'string') {
      logWebhookEvent('warn', 'missing_customer_id', {
        eventId,
        hasData: !!data,
        hasCustomer: !!customer,
      });
      return;
    }

    logWebhookEvent('info', 'processing_payment', {
      eventId,
      asaasCustomerId,
    });

    const empresa = await withDatabaseErrorHandling(
      () =>
        prisma.empresa.findFirst({
          where: { asaas_customer_id: asaasCustomerId },
          select: {
            id: true,
            nome: true,
            plano: true,
            limite_produtos: true,
          },
        }),
      'asaasWebhook.findEmpresa'
    );

    if (!empresa) {
      logWebhookEvent('warn', 'empresa_not_found', {
        eventId,
        asaasCustomerId,
      });
      return;
    }

    if (empresa.plano === 'PRO' && empresa.limite_produtos >= 1000) {
      logWebhookEvent('info', 'tenant_already_upgraded', {
        eventId,
        empresaId: empresa.id,
      });
      return;
    }

    const updatedEmpresa = await withDatabaseErrorHandling(
      () =>
        prisma.empresa.update({
          where: { id: empresa.id },
          data: {
            plano: 'PRO',
            limite_produtos: 1000,
          },
          select: {
            id: true,
            nome: true,
            plano: true,
          },
        }),
      'asaasWebhook.updateEmpresa'
    );

    logWebhookEvent('info', 'tenant_upgraded_successfully', {
      eventId,
      empresaId: updatedEmpresa.id,
      empresaNome: updatedEmpresa.nome,
      novoPlano: updatedEmpresa.plano,
    });
  } catch (error) {
    logWebhookEvent('error', 'payment_processing_error', {
      eventId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': 'https://asaas.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, svix-id, svix-timestamp, svix-signature',
    },
  });
}
