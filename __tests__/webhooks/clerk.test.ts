import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindUnique = vi.fn();
const mockCreateEmpresa = vi.fn();
const mockCreateUsuario = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    usuario: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      create: (...args: any[]) => mockCreateUsuario(...args),
    },
    empresa: {
      create: (...args: any[]) => mockCreateEmpresa(...args),
    },
  },
  withDatabaseErrorHandling: vi.fn((fn: () => any) => fn()),
}));

vi.mock('@/lib/svix', () => ({
  verifySvixSignature: vi.fn(),
}));

function createMockRequest(
  body: unknown,
  headers?: Record<string, string>
): any {
  return {
    text: () => Promise.resolve(JSON.stringify(body)),
    method: 'POST',
    headers: {
      get: (name: string) => {
        const map: Record<string, string> = {
          'content-type': 'application/json',
          'svix-id': 'test_svix_id',
          'svix-timestamp': String(Math.floor(Date.now() / 1000)),
          'svix-signature': 'test_signature',
          ...headers,
        };
        return map[name.toLowerCase()] ?? null;
      },
    },
  };
}

describe('Clerk Webhook POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_secret_value';
  });

  it('should provision tenant and user on user.created event', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreateEmpresa.mockResolvedValue({ id: 1, nome: 'user' });
    mockCreateUsuario.mockResolvedValue({
      id: 'clerk_user_001',
      email: 'user@test.com',
      empresa_id: 1,
    });

    const { POST } = await import('@/app/api/webhooks/clerk/route');
    const request = createMockRequest({
      type: 'user.created',
      data: {
        id: 'clerk_user_001',
        email_addresses: [{ email_address: 'user@test.com' }],
      },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.status).toBe('provisioned');
    expect(body.empresaId).toBe(1);
    expect(mockCreateEmpresa).toHaveBeenCalledOnce();
    expect(mockCreateUsuario).toHaveBeenCalledOnce();
  });

  it('should return 200 if user already exists (idempotency)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'clerk_user_001',
      email: 'user@test.com',
    });

    const { POST } = await import('@/app/api/webhooks/clerk/route');
    const request = createMockRequest({
      type: 'user.created',
      data: {
        id: 'clerk_user_001',
        email_addresses: [{ email_address: 'user@test.com' }],
      },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('already_exists');
    expect(mockCreateEmpresa).not.toHaveBeenCalled();
    expect(mockCreateUsuario).not.toHaveBeenCalled();
  });

  it('should return 400 if Svix headers are missing', async () => {
    const { POST } = await import('@/app/api/webhooks/clerk/route');
    const request = createMockRequest(
      { type: 'user.created' },
      { 'svix-id': '', 'svix-timestamp': '', 'svix-signature': '' }
    );
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_REQUEST');
  });

  it('should return 200 and ignore non user.created events', async () => {
    const { POST } = await import('@/app/api/webhooks/clerk/route');
    const request = createMockRequest({
      type: 'session.created',
      data: { id: 'session_001' },
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ignored');
    expect(mockCreateEmpresa).not.toHaveBeenCalled();
  });
});
