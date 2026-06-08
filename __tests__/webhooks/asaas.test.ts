import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAsaasEvent } from '@/app/api/webhooks/asaas/route';

const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    empresa: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
  },
  withDatabaseErrorHandling: vi.fn((fn: () => any) => fn()),
}));

describe('handleAsaasEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should upgrade FREE tenant to PRO on payment confirmed', async () => {
    mockFindFirst.mockResolvedValue({
      id: 1,
      nome: 'Test Empresa',
      plano: 'FREE',
      limite_produtos: 50,
    });
    mockUpdate.mockResolvedValue({
      id: 1,
      nome: 'Test Empresa',
      plano: 'PRO',
    });

    await handleAsaasEvent(
      {
        event: 'PAYMENT_CONFIRMED',
        data: { customerId: 'cus_123' },
      },
      'evt_001'
    );

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { asaas_customer_id: 'cus_123' },
      })
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { plano: 'PRO', limite_produtos: 1000 },
      })
    );
  });

  it('should skip upgrade if tenant already PRO', async () => {
    mockFindFirst.mockResolvedValue({
      id: 1,
      nome: 'Test Empresa',
      plano: 'PRO',
      limite_produtos: 1000,
    });

    await handleAsaasEvent(
      {
        event: 'PAYMENT_CONFIRMED',
        data: { customerId: 'cus_123' },
      },
      'evt_001'
    );

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should skip if customer not found in database', async () => {
    mockFindFirst.mockResolvedValue(null);

    await handleAsaasEvent(
      {
        event: 'PAYMENT_CONFIRMED',
        data: { customerId: 'cus_unknown' },
      },
      'evt_001'
    );

    expect(mockFindFirst).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should handle missing customerId gracefully', async () => {
    await handleAsaasEvent(
      {
        event: 'PAYMENT_CONFIRMED',
        data: {},
      },
      'evt_001'
    );

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
