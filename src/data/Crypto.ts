const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(new Uint8Array(digest));
}

export function bufferToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function utf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

export function utf8String(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const DEFAULT_ITERATIONS = 600_000;

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    utf8(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptAesGcm(
  plain: Uint8Array,
  password: string,
  salt: Uint8Array,
  nonce: Uint8Array,
  iterations: number = DEFAULT_ITERATIONS,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const key = await deriveKey(password, salt, iterations);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
    key,
    plain,
  );
  return new Uint8Array(cipher);
}

export async function decryptAesGcm(
  cipher: Uint8Array,
  password: string,
  salt: Uint8Array,
  nonce: Uint8Array,
  iterations: number = DEFAULT_ITERATIONS,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const key = await deriveKey(password, salt, iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
      key,
      cipher,
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error('WRONG_PASSWORD_OR_DAMAGED');
  }
}

export { DEFAULT_ITERATIONS };
