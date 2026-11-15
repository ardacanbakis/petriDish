import { parseSessionObject, type ParseResult, type SessionFile } from './schema';

/**
 * Share links: a whole session (seed + event log) packed into the URL, so
 * opening the link recreates the experiment with no server involved.
 *
 * Format: `v1.` + base64url(deflate-raw(JSON)). The JSON is the session file
 * with its bulky optional parts kept (notes and measurements are part of the
 * experiment) and its name shortened.
 */
const PREFIX = 'v1.';
/** Query parameter (inside the hash route) that carries a shared session. */
export const SHARE_PARAM = 's';
/** Beyond this many characters some browsers, chat apps and mail clients truncate links. */
export const SHARE_URL_WARN_LENGTH = 8000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // A damaged link fails on the readable side, which is awaited below; the
  // matching rejections on the writable side must not go unhandled.
  writer.write(bytes as BufferSource).catch(() => undefined);
  writer.close().catch(() => undefined);
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Pack a session into the text that goes in a share link. */
export async function encodeShare(session: SessionFile): Promise<string> {
  const json = JSON.stringify(session);
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return PREFIX + toBase64Url(packed);
}

/** Unpack and validate the text from a share link. Never throws. */
export async function decodeShare(text: string): Promise<ParseResult> {
  if (!text.startsWith(PREFIX)) {
    return { ok: false, reason: 'invalid', detail: 'unrecognised share link format' };
  }
  try {
    const packed = fromBase64Url(text.slice(PREFIX.length));
    const json = new TextDecoder().decode(
      await pipe(packed, new DecompressionStream('deflate-raw')),
    );
    return parseSessionObject(JSON.parse(json));
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid',
      detail: error instanceof Error ? error.message : 'corrupt link',
    };
  }
}

/** The full link for a session, given the page's own URL without its hash. */
export function shareUrl(pageUrl: string, encoded: string): string {
  return `${pageUrl.split('#')[0]}#/lab?${SHARE_PARAM}=${encoded}`;
}

/** The shared-session text in a location hash such as "#/lab?s=v1.…", or null. */
export function shareFromHash(hash: string): string | null {
  const query = hash.split('?')[1];
  if (!query) return null;
  return new URLSearchParams(query).get(SHARE_PARAM);
}
