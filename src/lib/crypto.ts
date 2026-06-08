import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * ============================================================================
 * AES-256-GCM CRYPTOGRAPHY MODULE — LGPD / DATA-AT-REST ENCRYPTION
 * ============================================================================
 *
 * Camada obrigatória de criptografia em repouso para todos os dados pessoais
 * sensíveis armazenados no banco de dados PostgreSQL.
 *
 * Campos cobertos: CPF, telefone, endereço (rua, número, bairro, cidade, CEP),
 *                   dados bancários.
 *
 * Algoritmo:         AES-256-GCM (autenticado, padrão NIST FIPS 197)
 * Tamanho da chave:  256 bits (32 bytes) — via env ENCRYPTION_KEY
 * IV:                96 bits (12 bytes) aleatório por registro
 * Auth tag:          128 bits (16 bytes) anexada ao ciphertext
 * Codificação:       Base64 (segura para armazenamento em coluna TEXT)
 *
 * Formato do payload criptografado (armazenado em coluna TEXT):
 *   <IV:12bytes_base64>.<Ciphertext:base64>.<AuthTag:16bytes_base64>
 *
 * ⚠️  REGRAS DE SEGURANÇA:
 *   - NUNCA hardcodar a chave no código fonte
 *   - SEMPRE usar IV único por operação de encrypt
 *   - NUNCA usar MD5 ou SHA1 como função de derivação de chave
 *   - NUNCA armazenar a chave no banco de dados
 *   - NUNCA logar a chave ou o ciphertext
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;  // 96 bits — recomendado pelo NIST para GCM
const TAG_LENGTH = 16; // 128 bits — GCM produz tag de 16 bytes
const KEY_LENGTH = 32; // 256 bits

/**
 * UTF-8 prefixo usado para marcar o ciphertext e permitir detecção
 * de valores não-criptografados (útil durante migração de dados legados).
 */
const ENCRYPTED_PREFIX = 'AES256:';

// ---------------------------------------------------------------------------
// KEY RESOLUTION & VALIDATION
// ---------------------------------------------------------------------------

let _cachedKey: Buffer | null = null;

/**
 * Resolve e valida a chave de criptografia AES-256 a partir da variável de
 * ambiente ENCRYPTION_KEY.
 *
 * A chave é armazenada em cache após a primeira resolução para evitar
 * múltiplos acessos ao process.env.
 *
 * @returns Buffer de 32 bytes contendo a chave
 * @throws {Error} se ENCRYPTION_KEY estiver ausente ou tiver tamanho inválido
 */
function getEncryptionKey(): Buffer {
  if (_cachedKey) {
    return _cachedKey;
  }

  const key = process.env.ENCRYPTION_KEY;

  if (!key || key.length === 0) {
    throw new Error(
      'ENCRYPTION_KEY is required but not set. Generate with: openssl rand -base64 32'
    );
  }

  const keyBuffer = Buffer.from(key, 'base64');

  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes, got ${keyBuffer.length}. ` +
        'Generate with: openssl rand -base64 32'
    );
  }

  _cachedKey = keyBuffer;
  return _cachedKey;
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Criptografa um valor de texto usando AES-256-GCM.
 *
 * Cada chamada gera um IV aleatório único, então dois encrypts do mesmo
 * plaintext produzem ciphertexts diferentes — resistente a ataques de
 * análise de padrão.
 *
 * @param value - Texto plano a ser criptografado (ex: CPF, telefone, endereço)
 * @returns String no formato "AES256:<IV>.<Ciphertext>.<AuthTag>" em base64
 *          Retorna string vazia se value for vazio/null/undefined.
 *
 * @example
 *   encrypt("123.456.789-00")
 *   // => "AES256:AbCdEfGhIjKl.MnOpQrStUvWx.ZyXwVuTsRqPo"
 */
export function encrypt(value: string): string {
  if (!value) {
    return '';
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(value, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  const payload = [
    iv.toString('base64'),
    encrypted,
    authTag.toString('base64'),
  ].join('.');

  return ENCRYPTED_PREFIX + payload;
}

/**
 * Descriptografa um valor previamente criptografado com encrypt().
 *
 * @param encryptedValue - String no formato "AES256:<IV>.<Ciphertext>.<AuthTag>"
 * @returns Texto plano original descriptografado
 *          Retorna o valor original intacto se ele não estiver no formato
 *          criptografado (útil para compatibilidade com dados legados).
 *
 * @throws {Error} Se o payload estiver corrompido ou a chave/IV estiver incorreta
 *
 * @example
 *   decrypt("AES256:AbCdEfGhIjKl.MnOpQrStUvWx.ZyXwVuTsRqPo")
 *   // => "123.456.789-00"
 */
export function decrypt(encryptedValue: string): string {
  if (!encryptedValue) {
    return '';
  }

  // Compatibilidade com dados não-criptografados (pré-migração)
  if (!encryptedValue.startsWith(ENCRYPTED_PREFIX)) {
    return encryptedValue;
  }

  const payload = encryptedValue.slice(ENCRYPTED_PREFIX.length);
  const parts = payload.split('.');

  if (parts.length !== 3) {
    throw new Error(
      `Invalid encrypted payload: expected 3 parts, got ${parts.length}`
    );
  }

  const [ivBase64, ciphertextBase64, authTagBase64] = parts;

  const key = getEncryptionKey();
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error(
      `Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`
    );
  }

  if (authTag.length !== TAG_LENGTH) {
    throw new Error(
      `Invalid auth tag length: expected ${TAG_LENGTH} bytes, got ${authTag.length}`
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextBase64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Verifica se uma string está criptografada com o módulo crypto.
 * Útil para validar se os dados de um registro estão devidamente protegidos.
 *
 * @param value - Valor a ser verificado
 * @returns true se o valor começa com o prefixo de criptografia
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

// ---------------------------------------------------------------------------
// SELF-TEST (executado apenas na inicialização do módulo, nunca em produção)
// ---------------------------------------------------------------------------

if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
  try {
    const testKey = process.env.ENCRYPTION_KEY;
    if (testKey && Buffer.from(testKey, 'base64').length === KEY_LENGTH) {
      const original = 'test-value-123';
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);

      if (original !== decrypted) {
        console.error(
          '❌ CRYPTO SELF-TEST FAILED: encrypt/decrypt round-trip mismatch'
        );
      }

      // Verifica que dois encrypts produzem resultados diferentes (IV único)
      const encrypted2 = encrypt(original);
      if (encrypted === encrypted2) {
        console.error(
          '❌ CRYPTO SELF-TEST FAILED: IV is not unique per encryption'
        );
      }

      // Verifica que decrypt de um valor não-criptografado retorna ele mesmo
      const plainPassThrough = decrypt('not-encrypted-value');
      if (plainPassThrough !== 'not-encrypted-value') {
        console.error(
          '❌ CRYPTO SELF-TEST FAILED: plain passthrough broken'
        );
      }

      // Verifica que valor vazio retorna vazio
      if (encrypt('') !== '' || decrypt('') !== '') {
        console.error(
          '❌ CRYPTO SELF-TEST FAILED: empty value handling broken'
        );
      }
    }
  } catch {
    // Self-test silencioso — crypto não deve quebrar o startup
  }
}