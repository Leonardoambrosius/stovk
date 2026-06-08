import { prisma, withDatabaseErrorHandling } from '../lib/prisma';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getEmpresaId } from '../lib/tenant';

/** Zod schema for product creation / update */
const ProdutoSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório'),
  modelo: z.string().optional(),
  categoria: z.string().optional(),
  valor_custo: z.coerce.number().nonnegative(),
  valor_venda: z.coerce.number().nonnegative(),
  quantidade_atual: z.coerce.number().int().nonnegative(),
  estoque_minimo: z.coerce.number().int().nonnegative(),
});

type ProdutoInput = z.infer<typeof ProdutoSchema>;

type ProdutoActionResult =
  | { success: true }
  | { success: false; error: 'limit_exceeded' | 'database_error' };

/** List all products for the current tenant */
export async function listProdutos() {
  'use server';
  const empresaId = await getEmpresaId();
  return await withDatabaseErrorHandling(
    () =>
      prisma.produto.findMany({
        where: { empresa_id: empresaId },
        orderBy: { nome: 'asc' },
      }),
    'listProdutos'
  );
}

export async function criarProduto(data: ProdutoInput): Promise<ProdutoActionResult> {
  'use server';
  const parsed = ProdutoSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Validação falhou: ' + JSON.stringify(parsed.error.format()));
  }

  const empresaId = await getEmpresaId();

  try {
    const empresa = await withDatabaseErrorHandling(
      () =>
        prisma.empresa.findUnique({
          where: { id: empresaId },
          select: { limite_produtos: true },
        }),
      'criarProduto.findEmpresa'
    );

    if (!empresa) {
      throw new Error('Empresa não encontrada');
    }

    const currentCount = await withDatabaseErrorHandling(
      () => prisma.produto.count({ where: { empresa_id: empresaId } }),
      'criarProduto.countProdutos'
    );

    if (currentCount >= empresa.limite_produtos) {
      return { success: false, error: 'limit_exceeded' };
    }

    await withDatabaseErrorHandling(
      () =>
        prisma.produto.create({
          data: {
            ...parsed.data,
            empresa_id: empresaId,
          },
        }),
      'criarProduto.createProduto'
    );

    revalidatePath('/dashboard/produtos');
    return { success: true };
  } catch (error) {
    console.error('[criarProduto] error', error);
    return { success: false, error: 'database_error' };
  }
}

/** Update an existing product – only if it belongs to the tenant */
export async function atualizarProduto(id: number, data: ProdutoInput) {
  'use server';
  const parsed = ProdutoSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Validação falhou: ' + JSON.stringify(parsed.error.format()));
  }

  const empresaId = await getEmpresaId();
  const result = await withDatabaseErrorHandling(
    () =>
      prisma.produto.updateMany({
        where: { id, empresa_id: empresaId },
        data: parsed.data,
      }),
    'atualizarProduto'
  );

  if (result.count === 0) {
    throw new Error('Produto não encontrado ou não autorizado');
  }

  revalidatePath('/dashboard/produtos');
}

/** Delete a product – only if it belongs to the tenant */
export async function excluirProduto(id: number) {
  'use server';
  const empresaId = await getEmpresaId();
  const result = await withDatabaseErrorHandling(
    () =>
      prisma.produto.deleteMany({
        where: { id, empresa_id: empresaId },
      }),
    'excluirProduto'
  );

  if (result.count === 0) {
    throw new Error('Produto não encontrado ou não autorizado');
  }

  revalidatePath('/dashboard/produtos');
}
