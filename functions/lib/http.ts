/** Byte limits apply while reading, including bodies without Content-Length. */
export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the supported byte limit.');
  }
}

export async function readBoundedText(
  input: Pick<Request, 'headers' | 'body'>,
  maxBytes: number,
): Promise<string> {
  const declared = input.headers.get('Content-Length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw new BodyTooLargeError();
  if (!input.body) return '';
  const reader = input.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
