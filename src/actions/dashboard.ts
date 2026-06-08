import { prisma, withDatabaseErrorHandling } from '../lib/prisma';
import { getEmpresaId } from '../lib/tenant';

/**
 * Returns the four analytics metrics required for the main dashboard.
 * All queries are scoped to the tenant's `empresa_id`.
 */
export async function getDashboardMetrics() {
  const empresaId = await getEmpresaId();

  return await withDatabaseErrorHandling(async () => {
    const [productCount, empresa] = await Promise.all([
      prisma.produto.count({ where: { empresa_id: empresaId } }),
      prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { limite_produtos: true, plano: true },
      }),
    ]);

    const lowStockResult = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM "Produto"
      WHERE "empresa_id" = ${empresaId}
        AND "quantidade_atual" <= "estoque_minimo"
    `;

    const lowStockCount = Number(lowStockResult[0]?.count ?? 0);

    const openOrdersCount = await prisma.ordemServico.count({
      where: { empresa_id: empresaId, NOT: { status: 'CONCLUIDA' } },
    });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const revenue = await prisma.ordemServico.aggregate({
      where: {
        empresa_id: empresaId,
        status: 'CONCLUIDA',
        createdAt: { gte: startOfMonth },
      },
      _sum: { valor_total: true },
    });

    return {
      productCount,
      productLimit: empresa?.limite_produtos ?? 0,
      lowStockCount,
      openOrdersCount,
      revenue: Number(revenue._sum?.valor_total ?? 0),
      plan: empresa?.plano ?? 'FREE',
    };
  }, 'getDashboardMetrics');
}
