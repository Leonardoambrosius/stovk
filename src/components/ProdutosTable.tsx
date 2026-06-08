"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useState, useTransition } from "react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { criarProduto } from "@/actions/produtos";
import { z } from "zod";

/** Zod schema repeated for client‑side validation */
const ProdutoSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  modelo: z.string().optional(),
  categoria: z.string().optional(),
  valor_custo: z.coerce.number().nonnegative(),
  valor_venda: z.coerce.number().nonnegative(),
  quantidade_atual: z.coerce.number().int().nonnegative(),
  estoque_minimo: z.coerce.number().int().nonnegative(),
});

type ProdutoInput = z.infer<typeof ProdutoSchema>;

interface Produto {
  id: number;
  nome: string;
  modelo?: string;
  categoria?: string;
  valor_custo: number;
  valor_venda: number;
  quantidade_atual: number;
  estoque_minimo: number;
}

export function ProdutosTable({ produtos }: { produtos: Produto[] }) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProdutoInput>({
    nome: "",
    modelo: "",
    categoria: "",
    valor_custo: 0,
    valor_venda: 0,
    quantidade_atual: 0,
    estoque_minimo: 0,
  });
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: name.startsWith("valor") || name.includes("quantidade") ? Number(value) : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = ProdutoSchema.safeParse(form);
    if (!result.success) {
      setError("Validação falhou. Verifique os campos.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const response = await criarProduto(result.data);
        // The server action returns an object { success: boolean, error?: string }
        if (response && typeof response === "object" && "success" in response) {
          if (!response.success && response.error === "limit_exceeded") {
            setError("Limite de produtos atingido. Atualize seu plano para continuar.");
            return;
          }
        }
        setOpen(false);
      } catch (err: any) {
        setError(err.message ?? "Erro ao criar produto");
      }
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="mb-4" disabled={isPending}>
            + Novo Produto
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar Produto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-2 items-center">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" name="nome" value={form.nome} onChange={handleChange} required />
            </div>
            <div className="grid grid-cols-2 gap-2 items-center">
              <Label htmlFor="modelo">Modelo</Label>
              <Input id="modelo" name="modelo" value={form.modelo ?? ""} onChange={handleChange} />
            </div>
            <div className="grid grid-cols-2 gap-2 items-center">
              <Label htmlFor="categoria">Categoria</Label>
              <Input id="categoria" name="categoria" value={form.categoria ?? ""} onChange={handleChange} />
            </div>
            <div className="grid grid-cols-2 gap-2 items-center">
              <Label htmlFor="valor_custo">Valor Custo</Label>
              <Input id="valor_custo" name="valor_custo" type="number" step="0.01" value={form.valor_custo} onChange={handleChange} required />
            </div>
            <div className="grid grid-cols-2 gap-2 items-center">
              <Label htmlFor="valor_venda">Valor Venda</Label>
              <Input id="valor_venda" name="valor_venda" type="number" step="0.01" value={form.valor_venda} onChange={handleChange} required />
            </div>
            <div className="grid grid-cols-2 gap-2 items-center">
              <Label htmlFor="quantidade_atual">Qtd Atual</Label>
              <Input id="quantidade_atual" name="quantidade_atual" type="number" value={form.quantidade_atual} onChange={handleChange} required />
            </div>
            <div className="grid grid-cols-2 gap-2 items-center">
              <Label htmlFor="estoque_minimo">Estoque Mínimo</Label>
              <Input id="estoque_minimo" name="estoque_minimo" type="number" value={form.estoque_minimo} onChange={handleChange} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Criando..." : "Criar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead>Estoque</TableHead>
            <TableHead>Preço Venda</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {produtos.map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.nome}</TableCell>
              <TableCell>{p.modelo ?? "-"}</TableCell>
              <TableCell>{p.categoria ?? "-"}</TableCell>
              <TableCell>
                <span className="mr-2">{p.quantidade_atual}</span>
                {p.quantidade_atual <= p.estoque_minimo && (
                  <Badge variant="destructive">Estoque baixo</Badge>
                )}
              </TableCell>
              <TableCell>{p.valor_venda.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
