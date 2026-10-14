// -----------------------------------------------------------------------------
// The HTTP seam of the EZVIZ client: one function, `request`, over the global
// fetch of Node 22+. The tests replace it with the fake cloud of
// test/helpers/fakeCloud.js; nothing else in the code touches the network.
//
//   request({ method, url, headers, form, timeoutMs, maxBytes })
//     → { status, body: Buffer }
//
// `form` is sent as application/x-www-form-urlencoded, as the EZVIZ apps do.
// A network failure throws with a `code` (ENOTFOUND, ECONNREFUSED, TIMEOUT…).
// -----------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 25_000;
// An alarm picture is a few hundred kilobytes; nothing the cloud sends is
// larger than this, and the sandbox has 256 MB.
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export class NetworkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NetworkError';
    this.code = code;
  }
}

async function readLimited(response, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new NetworkError('TOO_LARGE', `Answer larger than ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** The production request, over fetch. */
export async function httpRequest({
  method = 'GET',
  url,
  headers = {},
  form,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (form) {
    init.body = new URLSearchParams(
      Object.entries(form).filter(([, value]) => value !== undefined && value !== null),
    ).toString();
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  init.signal = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new NetworkError('TIMEOUT', `No answer within ${timeoutMs / 1000} s`);
    }
    const code = err.cause?.code ?? err.code ?? 'NETWORK';
    throw new NetworkError(code, code);
  }
  try {
    return { status: response.status, body: await readLimited(response, maxBytes) };
  } catch (err) {
    if (err instanceof NetworkError) {
      throw err;
    }
    throw new NetworkError('TIMEOUT', `Answer interrupted: ${err.name}`);
  }
}
