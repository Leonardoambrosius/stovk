import type { Prisma } from '@prisma/client';
import { prisma, withDatabaseErrorHandling } from '../lib/prisma';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getEmpresaId } from '../lib/tenant';


/** Zod schema for creating a Service Order */
const OrdemServicoSchema = z.object({
  cliente_nome: z.string().min(1, 'Nome do cliente é obrigatório'),
  descricao: z.string().optional(),
  itens: z
    .array(
      z.object({
        produto_id: z.coerce.number().int().positive(),
        quantidade: z.coerce.number().int().positive(),
      })
    )
    .min(1, 'Deve haver ao menos um item'),
});

type OrdemInput = z.infer<typeof OrdemServicoSchema>;

/** List all Service Orders for the current tenant */
export async function listOrdensServico() {
  'use server';
  const empresaId = await getEmpresaId();

  return await withDatabaseErrorHandling(
    () =>
      prisma.ordemServico.findMany({
        where: { empresa_id: empresaId },
        include: { itens: { include: { produto: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    'listOrdensServico'
  );
}

/** Create a new Service Order (items are not yet deducted from stock) */
export async function criarOrdemServico(data: OrdemInput) {
  'use server';
  const parse = OrdemServicoSchema.safeParse(data);
  if (!parse.success) {
    throw new Error('Validação falhou: ' + JSON.stringify(parse.error.format()));
  }

  const empresaId = await getEmpresaId();

  await withDatabaseErrorHandling(
    async () => {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const ordem = await tx.ordemServico.create({
          data: {
            empresa_id: empresaId,
            cliente_nome: parse.data.cliente_nome,
            descricao: parse.data.descricao,
            status: 'ABERTA',
            valor_total: 0,
          },
        });

        let total = 0;
        for (const item of parse.data.itens) {
          const produto = await tx.produto.findFirst({
            where: { id: item.produto_id, empresa_id: empresaId },
            select: {
              valor_venda: true,
              quantidade_atual: true,
              nome: true,
              empresa_id: true,
            },
          });

          if (!produto) {
            throw new Error(`Produto id ${item.produto_id} não encontrado para esta empresa`);
          }

          const valorUnitario = Number(produto.valor_venda);
          const itemTotal = valorUnitario * item.quantidade;
          total += itemTotal;

          await tx.itemOS.create({
            data: {
              os_id: ordem.id,
              produto_id: item.produto_id,
              quantidade: item.quantidade,
              valor_unitario: valorUnitario,
            },
          });
        }

        await tx.ordemServico.update({
          where: { id: ordem.id },
          data: { valor_total: total },
        });
      });
    },
    'criarOrdemServico'
  );

  revalidatePath('/dashboard/os');
}

/** Update the status of an existing Service Order */
export async function atualizarStatusOrdem(
  id: number,
  novoStatus: 'ABERTA' | 'ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA'
) {
  'use server';
  const empresaId = await getEmpresaId();

  await withDatabaseErrorHandling(
    async () => {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const ordem = await tx.ordemServico.findUnique({
          where: { id },
          select: { empresa_id: true, status: true },
        });

        if (!ordem || ordem.empresa_id !== empresaId) {
          throw new Error('Ordem não encontrada ou acesso não autorizado');
        }

        if (novoStatus === 'CONCLUIDA' && ordem.status !== 'CONCLUIDA') {
          const itens = await tx.itemOS.findMany({
            where: { os_id: id },
            include: { produto: true },
          });

          for (const item of itens) {
            const produto = item.produto;
            if (!produto || produto.empresa_id !== empresaId) {
              throw new Error('Produto associado ao item não pertence a esta empresa');
            }

            if (produto.quantidade_atual < item.quantidade) {
              throw new Error(
                `Estoque insuficiente para o produto "${produto.nome}" (required ${item.quantidade}, available ${produto.quantidade_atual})`
              );
            }
          }

          for (const item of itens) {
            const updateResult = await tx.produto.updateMany({
              where: { id: item.produto_id, empresa_id: empresaId },
              data: {
                quantidade_atual: {
                  decrement: item.quantidade,
                },
              },
            });

            if (updateResult.count === 0) {
              throw new Error(`Falha ao atualizar estoque do produto ${item.produto_id}`);
            }
          }
        }

        await tx.ordemServico.update({
          where: { id },
          data: { status: novoStatus },
        });
      });
    },
    'atualizarStatusOrdem'
  );

  revalidatePath('/dashboard/os');
}

/** Delete a Service Order (only allowed if not CONCLUIDA) */
export async function excluirOrdemServico(id: number) {
  'use server';
  const empresaId = await getEmpresaId();

  await withDatabaseErrorHandling(
    async () => {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const ordem = await tx.ordemServico.findUnique({
          where: { id },
          select: { empresa_id: true, status: true },
        });

        if (!ordem || ordem.empresa_id !== empresaId) {
          throw new Error('Ordem não encontrada ou acesso não autorizado');
        }

        if (ordem.status === 'CONCLUIDA') {
          throw new Error('Não é permitido excluir ordem já concluída');
        }

        await tx.itemOS.deleteMany({ where: { os_id: id } });
        await tx.ordemServico.delete({ where: { id } });
      });
    },
    'excluirOrdemServico'
  );

  revalidatePath('/dashboard/os');
}
