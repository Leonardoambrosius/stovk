import { Webhook } from 'svix';

/**
 * Verify a Svix webhook signature.
 * Throws if the signature is invalid.
 */
export function verifySvixSignature(payload: Buffer, signature: string, secret: string) {
  const wh = new Webhook(secret);
  wh.verify(payload, { 'svix-signature': signature });
}
