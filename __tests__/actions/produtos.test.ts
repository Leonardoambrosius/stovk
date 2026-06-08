import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindUnique = vi.fn();
const mockCount = vi.fn();
const mockCreate = vi.fn();
const mockFindMany = vi.fn();
const mockUpdateMany = vi.fn();
const mockDeleteMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    empresa: { findUnique: (...args: any[]) => mockFindUnique(...args) },
    produto: {
      count: (...args: any[]) => mockCount(...args),
      create: (...args: any[]) => mockCreate(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args),
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
    },
  },
  withDatabaseErrorHandling: vi.fn((fn: () => any) => fn()),
}));

vi.mock('@/lib/tenant', () => ({
  getEmpresaId: vi.fn(() => Promise.resolve(1)),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('Produtos Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('criarProduto', () => {
    it('should reject empty nome', async () => {
      const { criarProduto } = await import('@/actions/produtos');
      await expect(
        criarProduto({
          nome: '',
          valor_custo: 10,
          valor_venda: 20,
          quantidade_atual: 5,
          estoque_minimo: 2,
        })
      ).rejects.toThrow('Validação falhou');
    });

    it('should reject negative valor_custo', async () => {
      const { criarProduto } = await import('@/actions/produtos');
      await expect(
        criarProduto({
          nome: 'Produto Test',
          valor_custo: -1,
          valor_venda: 20,
          quantidade_atual: 5,
          estoque_minimo: 2,
        })
      ).rejects.toThrow('Validação falhou');
    });

    it('should return limit_exceeded if tenant is at product limit', async () => {
      mockFindUnique.mockResolvedValue({ limite_produtos: 5 });
      mockCount.mockResolvedValue(5);

      const { criarProduto } = await import('@/actions/produtos');
      const result = await criarProduto({
        nome: 'Produto Test',
        valor_custo: 10,
        valor_venda: 20,
        quantidade_atual: 5,
        estoque_minimo: 2,
      });

      expect(result).toEqual({ success: false, error: 'limit_exceeded' });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should create product when within limit', async () => {
      mockFindUnique.mockResolvedValue({ limite_produtos: 50 });
      mockCount.mockResolvedValue(5);
      mockCreate.mockResolvedValue({ id: 1, nome: 'Produto Test' });

      const { criarProduto } = await import('@/actions/produtos');
      const result = await criarProduto({
        nome: 'Produto Test',
        valor_custo: 10,
        valor_venda: 20,
        quantidade_atual: 5,
        estoque_minimo: 2,
      });

      expect(result).toEqual({ success: true });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nome: 'Produto Test',
            empresa_id: 1,
          }),
        })
      );
    });
  });

  describe('listProdutos', () => {
    it('should scope query to current tenant', async () => {
      mockFindMany.mockResolvedValue([]);

      const { listProdutos } = await import('@/actions/produtos');
      await listProdutos();

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { empresa_id: 1 },
        })
      );
    });
  });

  describe('atualizarProduto', () => {
    it('should only update product belonging to tenant', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });

      const { atualizarProduto } = await import('@/actions/produtos');
      await atualizarProduto(42, {
        nome: 'Updated',
        valor_custo: 15,
        valor_venda: 30,
        quantidade_atual: 10,
        estoque_minimo: 3,
      });

      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 42, empresa_id: 1 },
        })
      );
    });

    it('should throw if product not found or unauthorized', async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });

      const { atualizarProduto } = await import('@/actions/produtos');
      await expect(
        atualizarProduto(999, {
          nome: 'Updated',
          valor_custo: 15,
          valor_venda: 30,
          quantidade_atual: 10,
          estoque_minimo: 3,
        })
      ).rejects.toThrow('Produto não encontrado ou não autorizado');
    });
  });

  describe('excluirProduto', () => {
    it('should only delete product belonging to tenant', async () => {
      mockDeleteMany.mockResolvedValue({ count: 1 });

      const { excluirProduto } = await import('@/actions/produtos');
      await excluirProduto(42);

      expect(mockDeleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 42, empresa_id: 1 },
        })
      );
    });

    it('should throw if product not found or unauthorized', async () => {
      mockDeleteMany.mockResolvedValue({ count: 0 });

      const { excluirProduto } = await import('@/actions/produtos');
      await expect(excluirProduto(999)).rejects.toThrow(
        'Produto não encontrado ou não autorizado'
      );
    });
  });
});
