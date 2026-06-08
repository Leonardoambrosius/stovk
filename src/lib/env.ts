import { z } from 'zod';

/**
 * ============================================================================
 * ENVIRONMENT VARIABLES VALIDATION
 * ============================================================================
 * 
 * This file validates all required environment variables at runtime.
 * It ensures that critical secrets are present before the app starts.
 * 
 * This check runs once when the server starts, catching configuration
 * errors early rather than at request time.
 */

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url('DATABASE_URL deve ser uma URL PostgreSQL válida'),

  // Clerk Authentication (Required)
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY é obrigatório'),
  CLERK_SECRET_KEY: z
    .string()
    .min(1, 'CLERK_SECRET_KEY é obrigatório (não deve ter NEXT_PUBLIC_)')
    .refine((val) => !val.startsWith('NEXT_PUBLIC_'), {
      message: 'CLERK_SECRET_KEY não deve ter prefixo NEXT_PUBLIC_',
    }),

  // Clerk Webhooks (Required)
  CLERK_WEBHOOK_SECRET: z
    .string()
    .min(1, 'CLERK_WEBHOOK_SECRET é obrigatório'),

  // Asaas Payment (Optional — API calls not yet implemented)
  ASAAS_API_KEY: z
    .string()
    .optional()
    .refine((val) => !val || !val.startsWith('NEXT_PUBLIC_'), {
      message: 'ASAAS_API_KEY não deve ter prefixo NEXT_PUBLIC_',
    }),

  // Svix/Asaas Webhooks (Required)
  SVIX_ASAAS_SECRET: z
    .string()
    .min(1, 'SVIX_ASAAS_SECRET é obrigatório'),

  // Application URLs (Optional but recommended)
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().default('/sign-in'),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().default('/sign-up'),
  NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: z.string().default('/dashboard'),
  NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: z.string().default('/dashboard'),
  NEXT_PUBLIC_APP_DOMAIN: z.string().default('aurenstockos.online'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('https://aurenstockos.online'),
  NEXT_PUBLIC_ASAAS_API_URL: z.string().url().default('https://api.asaas.com/v3'),

  // Environment
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  NEXT_PUBLIC_ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// ============================================================================
// VALIDATE AND EXPORT
// ============================================================================

const parsed = envSchema.safeParse({
  // Database
  DATABASE_URL: process.env.DATABASE_URL,

  // Clerk
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET,

  // Asaas
  ASAAS_API_KEY: process.env.ASAAS_API_KEY,
  SVIX_ASAAS_SECRET: process.env.SVIX_ASAAS_SECRET,

  // App Config
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
  NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL,
  NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL,
  NEXT_PUBLIC_APP_DOMAIN: process.env.NEXT_PUBLIC_APP_DOMAIN,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_ASAAS_API_URL: process.env.NEXT_PUBLIC_ASAAS_API_URL,

  // Environment
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_ENVIRONMENT: process.env.NEXT_PUBLIC_ENVIRONMENT,

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL,
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

if (!parsed.success) {
  console.error(
    '❌ Erro crítico: Variáveis de ambiente ausentes ou inválidas\n',
    JSON.stringify(parsed.error.format(), null, 2)
  );

  console.error('\n📋 Variáveis obrigatórias:');
  console.error('  - DATABASE_URL');
  console.error('  - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
  console.error('  - CLERK_SECRET_KEY');
  console.error('  - CLERK_WEBHOOK_SECRET');
  console.error('  - SVIX_ASAAS_SECRET');

  throw new Error(
    'Variáveis de ambiente inválidas ou ausentes. Verifique o arquivo .env.local'
  );
}

// ============================================================================
// PRODUCTION WARNINGS
// ============================================================================

const env = parsed.data;

if (env.NODE_ENV === 'production') {
  if (env.CLERK_SECRET_KEY.includes('pk_test_') || env.CLERK_SECRET_KEY.includes('sk_test_')) {
    console.warn(
      '⚠️  Aviso: Você está usando credenciais de teste em produção!'
    );
  }

  if (env.ASAAS_API_KEY && env.ASAAS_API_KEY.includes('test_')) {
    console.warn(
      '⚠️  Aviso: Você está usando chave de teste do Asaas em produção!'
    );
  }
}

console.log('✅ Variáveis de ambiente carregadas com sucesso');

export { env };
