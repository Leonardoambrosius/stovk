import { PrismaClient, Prisma } from '@prisma/client';
import { env } from './env';

/**
 * Prisma Client singleton
 *
 * Prevents multiple instances in development (hot-reload)
 * and ensures a single connection pool in production.
 * For Neon serverless, prefer connection pooling via DATABASE_URL params
 * such as `?pgbouncer=true&connection_limit=1` when needed.
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const clientOptions: Prisma.PrismaClientOptions = {
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  errorFormat: 'minimal',
};

export const prisma: PrismaClient =
  globalThis.__prisma ?? new PrismaClient(clientOptions);

if (env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

export function normalizePrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return {
          code: error.code,
          message: 'Registro duplicado ou já existente.',
        };
      case 'P2025':
        return {
          code: error.code,
          message: 'Recurso não encontrado.',
        };
      default:
        return {
          code: error.code,
          message: 'Erro de banco de dados. Tente novamente.',
        };
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'Erro de validação do banco de dados. Verifique os dados enviados.',
    };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      code: 'INITIALIZATION_ERROR',
      message: 'Erro na inicialização do banco de dados. Contate o suporte.',
    };
  }

  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return {
      code: 'RUST_PANIC',
      message: 'Erro interno do banco de dados. Tente novamente mais tarde.',
    };
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return {
      code: 'UNKNOWN_REQUEST_ERROR',
      message: 'Erro desconhecido do banco de dados. Tente novamente.',
    };
  }

  if (error instanceof Error) {
    return {
      code: 'UNKNOWN_ERROR',
      message: 'Erro interno de banco de dados. Tente novamente.',
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: 'Erro interno de banco de dados. Tente novamente.',
  };
}

export async function withDatabaseErrorHandling<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const normalized = normalizePrismaError(error);
    console.error(`[DB][${context}]`, normalized.code, error);
    throw new Error(normalized.message);
  }
}
