import { prisma } from './prisma';
import { auth } from '@clerk/nextjs/server';

/**
 * ============================================================================
 * MULTI-TENANT ISOLATION - GET CURRENT TENANT
 * ============================================================================
 * 
 * This utility enforces multi-tenant isolation by:
 * 1. Requiring Clerk authentication
 * 2. Looking up the user's associated tenant (Empresa)
 * 3. Throwing errors if user or tenant not found
 * 4. Ensuring all queries are scoped to this tenant
 * 
 * Usage: Call this in your route handlers to get the current tenant ID
 * 
 * Example:
 *   const empresaId = await getEmpresaId();
 *   const produtos = await prisma.produto.findMany({
 *     where: { empresa_id: empresaId }
 *   });
 */

/**
 * Get the current authenticated user's tenant (Empresa) ID
 * 
 * Throws:
 * - Error if user is not authenticated
 * - Error if user record not found in database
 */
export async function getEmpresaId(): Promise<number> {
  const { userId } = await auth();

  if (!userId) {
    throw new Error('Authentication required: userId not found');
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: userId },
    select: { empresa_id: true },
  });

  if (!usuario) {
    throw new Error(`User record not found for Clerk user: ${userId}`);
  }

  return usuario.empresa_id;
}

/**
 * Get the current authenticated user's tenant (Empresa) record with details
 * 
 * Throws same errors as getEmpresaId()
 */
export async function getEmpresa() {
  const empresaId = await getEmpresaId();

  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
  });

  if (!empresa) {
    throw new Error(`Empresa record not found for ID: ${empresaId}`);
  }

  return empresa;
}

/**
 * Get current authenticated user's record
 * 
 * Throws:
 * - Error if user is not authenticated
 * - Error if user record not found in database
 */
export async function getCurrentUsuario() {
  const { userId } = await auth();

  if (!userId) {
    throw new Error('Authentication required: userId not found');
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: userId },
  });

  if (!usuario) {
    throw new Error(`User record not found for Clerk user: ${userId}`);
  }

  return usuario;
}

/**
 * Validate that a resource belongs to the current user's tenant
 * 
 * Use this to prevent cross-tenant access:
 * 
 * Example:
 *   const product = await prisma.produto.findUnique({ where: { id } });
 *   await validateTenantAccess(product.empresa_id);
 */
export async function validateTenantAccess(resourceEmpresaId: number): Promise<boolean> {
  const currentEmpresaId = await getEmpresaId();
  
  if (resourceEmpresaId !== currentEmpresaId) {
    throw new Error(
      `Access denied: Resource does not belong to user's tenant (${currentEmpresaId})`
    );
  }

  return true;
}
