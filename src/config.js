// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One EZVIZ account per installation: its e-mail (or phone number) and
// password, the API server of its region, the verification codes of the
// cameras (optional: encrypted images, RTSP address), and the pace of the
// cloud reads.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two reads of the alarm list (one request for every camera).
export const ALARM_INTERVALS = ['15', '30', '60', '120'];

// Minutes between two fresh captures of every mains-powered camera added to
// Gladys (`0`: only on an alarm, a scene action or the live view). Battery
// cameras are never woken up by the timer.
export const SNAPSHOT_INTERVALS = ['0', '5', '15', '60'];

// The European server; the login moves to the right region by itself when
// EZVIZ answers that the account lives elsewhere (code 1100).
export const DEFAULT_SERVER = 'apiieu.ezvizlife.com';

// Domains of the EZVIZ cloud: the password digest is sent nowhere else.
const SERVER_DOMAINS = /\.(ezvizlife\.com|ezvizru\.com|ezviz\.com)$/;

export const DEFAULT_CONFIG = {
  username: '',
  password: '',
  api_server: DEFAULT_SERVER,
  verification_codes: '',
  alarm_interval: '30',
  snapshot_interval: '15',
  allow_arming: true,
  allow_siren: false,
  language: 'fr',
};

/**
 * The API server typed by the user: a host name of the EZVIZ cloud
 * (`apiieu.ezvizlife.com`, `https://apiius.ezvizlife.com/`), or a region code
 * as pyEzviz accepts it (`eu` → `apiieu.ezvizlife.com`).
 * @returns {string|null} the host name, null when unusable
 */
export function parseServer(raw) {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!text) {
    return DEFAULT_SERVER;
  }
  if (/^[a-z]{2,4}$/.test(text)) {
    return `apii${text}.ezvizlife.com`;
  }
  let host;
  try {
    host = new URL(/^[a-z]+:\/\//.test(text) ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && SERVER_DOMAINS.test(host) ? host : null;
}

/**
 * The verification codes (the 6 letters on the sticker of each camera), as
 * typed: `SERIAL:CODE` pairs separated by commas, spaces or new lines, or one
 * bare code used for every camera without its own.
 * @returns {{ fallback: string|null, bySerial: Map<string, string>, invalid: number }}
 */
export function parseCodes(raw) {
  const result = { fallback: null, bySerial: new Map(), invalid: 0 };
  const text = typeof raw === 'string' ? raw : '';
  for (const entry of text.split(/[\s,;]+/).filter(Boolean)) {
    const match = entry.match(/^([A-Za-z0-9]{5,20})[:=]([A-Za-z0-9]{4,32})$/);
    if (match) {
      result.bySerial.set(match[1].toUpperCase(), match[2]);
    } else if (/^[A-Za-z0-9]{4,32}$/.test(entry) && result.fallback === null) {
      result.fallback = entry;
    } else {
      result.invalid += 1;
    }
  }
  return result;
}

const pickOption = (value, options, fallback) =>
  options.includes(String(value ?? '')) ? String(value) : fallback;

// A boolean field may arrive as a string from older form engines.
const flag = (value, fallback) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const typedServer = text('api_server');
  const server = parseServer(typedServer);
  const codes = parseCodes(source.verification_codes);
  const language = text('language');
  return {
    username: text('username'),
    // A password may legitimately start or end with a space: kept as typed.
    password: typeof source.password === 'string' ? source.password : '',
    server,
    // A server was typed but cannot be used: said in the connection status.
    serverInvalid: server === null,
    codes,
    alarmIntervalMs:
      Number(pickOption(source.alarm_interval, ALARM_INTERVALS, DEFAULT_CONFIG.alarm_interval)) *
      1000,
    snapshotIntervalMs:
      Number(
        pickOption(source.snapshot_interval, SNAPSHOT_INTERVALS, DEFAULT_CONFIG.snapshot_interval),
      ) * 60_000,
    allowArming: flag(source.allow_arming, DEFAULT_CONFIG.allow_arming),
    allowSiren: flag(source.allow_siren, DEFAULT_CONFIG.allow_siren),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
  };
}

/** The verification code of a camera, from the configuration. */
export function codeFor(config, serial) {
  return (
    config?.codes?.bySerial.get(String(serial).toUpperCase()) ?? config?.codes?.fallback ?? null
  );
}
