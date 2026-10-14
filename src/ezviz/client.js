// -----------------------------------------------------------------------------
// Client of the EZVIZ cloud: the private API of the EZVIZ mobile apps, as
// pyEzviz / pyezvizapi (Apache-2.0, the library of the Home Assistant `ezviz`
// integration) documents it. There is no public API for an EZVIZ consumer
// account: the endpoints below are the ones Home Assistant has used for
// years.
//
// Session:
//   POST /v3/users/login/v5          account, MD5(password), featureCode
//        meta.code 200 → loginSession { sessionId, rfSessionId },
//                         loginArea { apiDomain }, loginUser { username }
//        1100 → wrong region, loginArea.apiDomain is the right one
//        6002 → two-step verification: a code is sent by e-mail or SMS
//        1012 wrong code, 1013 unknown account, 1014 wrong password,
//        1015 account locked
//   PUT  /v3/apigateway/login        refreshSessionId → a new session
//   POST /v3/sms/nologin/checkcode   sends the verification code again
// Every other request carries the `sessionId` header; an HTTP 401 (or a
// meta.code 401/403) means the session expired: refreshed once, then the
// caller logs in again (`onSessionLost`).
//
// Reads:
//   GET  /v3/userdevices/v1/resources/pagelist   every device, by section
//   GET  /v3/unifiedmsg/list                     the latest alarms, all cameras
//   GET  /v3/userdevices/v1/group/defenceMode    the arming mode of the account
// Commands:
//   POST /v3/userdevices/v1/group/switchDefenceMode     arming mode
//   PUT  /v3/devices/{serial}/{ch}/{on}/{type}/switchStatus   a switch (privacy 7,
//        light 303), falling back to POST /api/device/switchStatus
//   PUT  /v3/devices/{serial}/1/changeDefenceStatusReq    motion detection
//   PUT  /v3/devices/{serial}/0/sendAlarm                 siren (2 on, 1 off)
//   PUT  /v3/devices/{serial}/ptzControl                  pan / tilt
//   PUT  /v3/devconfig/v1/{serial}/1/capture              a fresh picture
//   POST /api/device/query/encryptkey                     the picture key
//
// Errors are thrown as EzvizError with a `kind`, the one thing the hub, the
// texts and the logs need. Never the password, a session id or a picture URL
// in a message.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { passwordDigest } from './crypto.js';
import { NetworkError, httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // the cloud does not answer
  AUTH: 'auth', // unknown account or wrong password
  LOCKED: 'locked', // too many attempts: EZVIZ locked the account
  MFA_REQUIRED: 'mfa_required', // a verification code was sent
  MFA_INVALID: 'mfa_invalid', // the code typed is wrong or expired
  SESSION: 'session', // the session expired and could not be renewed
  OFFLINE: 'offline', // the camera does not answer the cloud
  API: 'api', // any other refusal
});

export class EzvizError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message
   * @param {{ code?: number|string, status?: number }} [details]
   */
  constructor(kind, message, { code, status } = {}) {
    super(message);
    this.name = 'EzvizError';
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

// Login answers, by meta.code.
const LOGIN_ERRORS = {
  1012: [ERROR_KINDS.MFA_INVALID, 'Verification code refused'],
  1013: [ERROR_KINDS.AUTH, 'Unknown account'],
  1014: [ERROR_KINDS.AUTH, 'Wrong password'],
  1015: [ERROR_KINDS.LOCKED, 'Account locked by EZVIZ'],
  6002: [ERROR_KINDS.MFA_REQUIRED, 'Two-step verification required'],
};

// The sections of the device list: the exact filter pyezvizapi sends (the one
// Home Assistant users run), though the integration reads only CONNECTION,
// SWITCH, STATUS and WIFI.
export const PAGELIST_FILTER =
  'CLOUD, TIME_PLAN, CONNECTION, SWITCH,STATUS, WIFI, NODISTURB, KMS,P2P, CHANNEL, VTM, DETECTOR,' +
  'FEATURE, CUSTOM_TAG, UPGRADE, VIDEO_QUALITY,QOS, PRODUCTS_INFO, SIM_CARD, MULTI_UPGRADE_EXT,' +
  'FEATURE_INFO';
const PAGE_SIZE = 30;
// Unified message subtype "all alarms" of the app.
const ALL_ALARMS = '92';

// Codes the cameras answer when they cannot be reached by the cloud.
const OFFLINE_CODES = new Set(['2003', '2009', '20007', '20008']);

/** The headers of the EZVIZ apps (web profile, as pyEzviz sends them). */
export function baseHeaders(featureCode, sessionId = '') {
  return {
    featureCode,
    clientType: '3',
    osVersion: '',
    clientVersion: '',
    netType: 'WIFI',
    customno: '1000001',
    ssid: '',
    clientNo: 'web_site',
    appId: 'ys7',
    language: 'en_GB',
    lang: 'en',
    sessionId,
    'User-Agent': 'okhttp/3.12.1',
  };
}

const metaCode = (payload) => {
  const code = payload?.meta?.code;
  return code === undefined || code === null ? null : Number(code);
};

const isOk = (payload) =>
  metaCode(payload) === 200 || payload?.resultCode === 0 || payload?.resultCode === '0';

const resultCode = (payload) => metaCode(payload) ?? payload?.resultCode ?? payload?.status;

/** The first https picture address of an answer (shapes vary by firmware). */
export function firstImageUrl(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return (
      value
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('https://')) ?? null
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImageUrl(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['picUrl', 'picURL', 'imageUrl', 'captureUrl', 'pic', 'pics', 'url']) {
      const found = typeof value[key] === 'string' ? firstImageUrl(value[key]) : null;
      if (found) {
        return found;
      }
    }
    for (const item of Object.values(value)) {
      if (item && typeof item === 'object') {
        const found = firstImageUrl(item, depth + 1);
        if (found) {
          return found;
        }
      }
    }
  }
  return null;
}

/** Merge a page of the device list into the pages before. */
function mergePages(into, page) {
  for (const [key, value] of Object.entries(page)) {
    if (key === 'meta' || key === 'page') {
      continue;
    }
    if (Array.isArray(value)) {
      into[key] = [...(Array.isArray(into[key]) ? into[key] : []), ...value];
    } else if (value && typeof value === 'object') {
      into[key] = { ...(into[key] ?? {}), ...value };
    } else if (!(key in into)) {
      into[key] = value;
    }
  }
  return into;
}

export class EzvizClient {
  /**
   * @param {object} options
   * @param {string} options.server API host of the region (apiieu.ezvizlife.com)
   * @param {string} options.featureCode the stable terminal id of this installation
   * @param {object|null} [options.session] a saved session { apiDomain, sessionId, rfSessionId, user }
   * @param {(session: object) => void} [options.onSession] a new session to save
   * @param {Function} [options.request] HTTP seam (src/ezviz/http.js)
   * @param {number} [options.timeoutMs]
   */
  constructor({ server, featureCode, session = null, onSession, request, timeoutMs }) {
    this.server = server;
    this.featureCode = featureCode;
    this.session = session && session.sessionId ? { ...session } : null;
    this.onSession = onSession ?? (() => {});
    this.request = request ?? httpRequest;
    this.timeoutMs = timeoutMs;
    this.refreshing = null;
  }

  get apiDomain() {
    return this.session?.apiDomain ?? this.server;
  }

  get loggedIn() {
    return Boolean(this.session?.sessionId);
  }

  // --- Transport ------------------------------------------------------------

  async send({ method, url, form, auth = true, maxBytes }) {
    const headers = baseHeaders(this.featureCode, auth ? (this.session?.sessionId ?? '') : '');
    try {
      return await this.request({
        method,
        url,
        headers,
        form,
        timeoutMs: this.timeoutMs,
        maxBytes,
      });
    } catch (err) {
      if (err instanceof NetworkError || err.code) {
        throw new EzvizError(ERROR_KINDS.UNREACHABLE, `EZVIZ cloud unreachable (${err.code})`, {
          code: err.code,
        });
      }
      throw err;
    }
  }

  static parse(response, what) {
    if (response.status >= 500 || response.status === 429) {
      throw new EzvizError(ERROR_KINDS.UNREACHABLE, `${what}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    try {
      return JSON.parse(response.body.toString('utf8'));
    } catch {
      throw new EzvizError(ERROR_KINDS.API, `${what}: the answer is not JSON`, {
        status: response.status,
      });
    }
  }

  /**
   * One API call with the session: renewed once when it expired.
   * @returns {Promise<object>} the JSON answer, checked
   */
  async call(method, path, { query, form, what = path, check = true } = {}, retried = false) {
    if (!this.session) {
      throw new EzvizError(ERROR_KINDS.SESSION, 'Not logged in');
    }
    const url = new URL(`https://${this.apiDomain}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    const response = await this.send({ method, url: url.toString(), form });
    const expired =
      response.status === 401 ||
      (response.status < 300 && [401, 403].includes(metaCode(EzvizClient.tryParse(response))));
    if (expired) {
      if (retried) {
        throw new EzvizError(ERROR_KINDS.SESSION, `${what}: session refused`, { status: 401 });
      }
      await this.refresh();
      return this.call(method, path, { query, form, what, check }, true);
    }
    if (response.status >= 400 && response.status !== 401) {
      // A server error or a rate limit is temporary: the next read tries again.
      const kind =
        response.status >= 500 || response.status === 429
          ? ERROR_KINDS.UNREACHABLE
          : ERROR_KINDS.API;
      throw new EzvizError(kind, `${what}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    const payload = EzvizClient.parse(response, what);
    if (check && !isOk(payload)) {
      const code = String(resultCode(payload) ?? '?');
      const kind = OFFLINE_CODES.has(code) ? ERROR_KINDS.OFFLINE : ERROR_KINDS.API;
      throw new EzvizError(kind, `${what}: refused (code ${code})`, { code });
    }
    return payload;
  }

  static tryParse(response) {
    try {
      return JSON.parse(response.body.toString('utf8'));
    } catch {
      return null;
    }
  }

  // --- Session --------------------------------------------------------------

  /**
   * Log in with the account. Throws MFA_REQUIRED after asking EZVIZ to send
   * a code (6002), unless a `code` is given.
   * @param {{ username: string, password: string, code?: string }} credentials
   */
  async login({ username, password, code }, redirected = false) {
    const response = await this.send({
      method: 'POST',
      url: `https://${this.server}/v3/users/login/v5`,
      auth: false,
      form: {
        account: username,
        password: passwordDigest(password),
        featureCode: this.featureCode,
        msgType: code ? '3' : '0',
        bizType: code ? 'TERMINAL_BIND' : '',
        // Client name shown in the EZVIZ account ("Gladys", base64).
        cuName: 'R2xhZHlz',
        smsCode: code ?? '',
      },
    });
    const payload = EzvizClient.parse(response, 'Login');
    const meta = metaCode(payload);
    if (meta === 200) {
      this.session = {
        apiDomain: String(payload.loginArea?.apiDomain || this.server),
        sessionId: String(payload.loginSession.sessionId),
        rfSessionId: String(payload.loginSession.rfSessionId),
        user: String(payload.loginUser?.username ?? ''),
      };
      this.onSession({ ...this.session });
      return this.session;
    }
    if (meta === 1100 && !redirected && payload.loginArea?.apiDomain) {
      // The account lives in another region: log in there.
      this.server = String(payload.loginArea.apiDomain);
      return this.login({ username, password, code }, true);
    }
    if (meta === 6002) {
      await this.sendCode(username).catch(() => {});
    }
    const [kind, message] = LOGIN_ERRORS[meta] ?? [ERROR_KINDS.API, 'Login refused'];
    throw new EzvizError(kind, `${message} (code ${meta ?? response.status})`, { code: meta });
  }

  /** Ask EZVIZ to send a verification code by e-mail or SMS. */
  async sendCode(username) {
    const response = await this.send({
      method: 'POST',
      url: `https://${this.server}/v3/sms/nologin/checkcode`,
      auth: false,
      form: { from: username, bizType: 'TERMINAL_BIND' },
    });
    const payload = EzvizClient.parse(response, 'Verification code');
    if (metaCode(payload) !== 200) {
      throw new EzvizError(
        ERROR_KINDS.API,
        `Verification code not sent (code ${metaCode(payload)})`,
        {
          code: metaCode(payload),
        },
      );
    }
  }

  /** Renew the session with its refresh id; SESSION when EZVIZ refuses it. */
  refresh() {
    this.refreshing ??= this.renew().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async renew() {
    if (!this.session?.rfSessionId) {
      throw new EzvizError(ERROR_KINDS.SESSION, 'No session to renew');
    }
    const response = await this.send({
      method: 'PUT',
      url: `https://${this.apiDomain}/v3/apigateway/login`,
      auth: false,
      form: { refreshSessionId: this.session.rfSessionId, featureCode: this.featureCode },
    });
    const payload =
      response.status === 401 || response.status === 403
        ? { meta: { code: response.status } }
        : EzvizClient.parse(response, 'Session renewal');
    const meta = metaCode(payload);
    if (meta !== 200 || !payload.sessionInfo?.sessionId) {
      this.session = null;
      throw new EzvizError(ERROR_KINDS.SESSION, `Session expired (code ${meta})`, { code: meta });
    }
    this.session = {
      ...this.session,
      sessionId: String(payload.sessionInfo.sessionId),
      rfSessionId: String(payload.sessionInfo.refreshSessionId ?? this.session.rfSessionId),
    };
    this.onSession({ ...this.session });
    return this.session;
  }

  // --- Reads ----------------------------------------------------------------

  /** Every device of the account, its sections merged across pages. */
  async deviceList() {
    let merged = {};
    for (let offset = 0, page = 0; page < 20; page += 1, offset += PAGE_SIZE) {
      const payload = await this.call('GET', '/v3/userdevices/v1/resources/pagelist', {
        query: { groupId: -1, limit: PAGE_SIZE, offset, filter: PAGELIST_FILTER },
        what: 'Device list',
      });
      merged = mergePages(merged, payload);
      if (!payload.page?.hasNext) {
        break;
      }
    }
    return merged;
  }

  /** The latest alarms of every camera, newest first. */
  async alarms({ limit = 20 } = {}) {
    const payload = await this.call('GET', '/v3/unifiedmsg/list', {
      query: { stype: ALL_ALARMS, limit, endTime: '' },
      what: 'Alarm list',
    });
    const list = payload.message ?? payload.messages ?? [];
    return Array.isArray(list) ? list : [];
  }

  /** The arming mode of the account (1 home, 2 away, 3 sleep). */
  async defenceMode() {
    const payload = await this.call('GET', '/v3/userdevices/v1/group/defenceMode', {
      query: { groupId: -1 },
      what: 'Arming mode',
    });
    const mode = Number(payload.mode);
    return Number.isFinite(mode) ? mode : null;
  }

  // --- Commands ---------------------------------------------------------------

  setDefenceMode(mode) {
    return this.call('POST', '/v3/userdevices/v1/group/switchDefenceMode', {
      form: { groupId: -1, mode },
      what: 'Arming mode change',
    });
  }

  /** A switch of a camera, by its EZVIZ type number. */
  async setSwitch(serial, type, enable, channel = 0) {
    const on = enable ? 1 : 0;
    const device = encodeURIComponent(serial);
    try {
      return await this.call('PUT', `/v3/devices/${device}/${channel}/${on}/${type}/switchStatus`, {
        what: `Switch ${type}`,
      });
    } catch (err) {
      if (err.kind !== ERROR_KINDS.API) {
        throw err;
      }
      // Older firmware only knows the legacy endpoint.
      return this.call('POST', '/api/device/switchStatus', {
        form: { serial, enable: String(on), type: String(type), channel: String(channel) },
        what: `Switch ${type}`,
      }).catch(() => {
        throw err;
      });
    }
  }

  /** Motion detection of a camera (the "alarm notification" of the app). */
  setDetection(serial, enable) {
    return this.call('PUT', `/v3/devices/${encodeURIComponent(serial)}/1/changeDefenceStatusReq`, {
      form: { type: 'Global', status: enable ? 1 : 0, actor: 'V' },
      what: 'Motion detection change',
    });
  }

  /** The siren of a camera: the firmware stops it by itself after a minute. */
  setSiren(serial, on) {
    return this.call('PUT', `/v3/devices/${encodeURIComponent(serial)}/0/sendAlarm`, {
      form: { enable: on ? 2 : 1 },
      what: 'Siren',
    });
  }

  /** One pan/tilt step: START then STOP, never a move left running. */
  async move(serial, direction, speed = 5) {
    const command = direction.toUpperCase();
    for (const action of ['START', 'STOP']) {
      await this.call('PUT', `/v3/devices/${encodeURIComponent(serial)}/ptzControl`, {
        form: { command, action, channelNo: 1, speed, uuid: randomUUID(), serial },
        what: 'Camera move',
        check: action === 'START',
      });
    }
  }

  /** Ask the camera for a fresh picture; resolves its address. */
  async capture(serial) {
    const payload = await this.call(
      'PUT',
      `/v3/devconfig/v1/${encodeURIComponent(serial)}/1/capture`,
      { what: 'Capture' },
    );
    const url = firstImageUrl(payload);
    if (!url) {
      throw new EzvizError(ERROR_KINDS.API, 'Capture: no picture in the answer');
    }
    return url;
  }

  /** The picture key EZVIZ keeps for a camera; null when it asks for a code. */
  async encryptionKey(serial) {
    const payload = await this.call('POST', '/api/device/query/encryptkey', {
      form: {
        checkcode: '',
        serial,
        clientNo: 'web_site',
        clientType: 3,
        netType: 'WIFI',
        featureCode: this.featureCode,
        sessionId: this.session?.sessionId ?? '',
      },
      what: 'Picture key',
      check: false,
    });
    const code = String(payload.resultCode ?? metaCode(payload));
    if (code === '0' && typeof payload.encryptkey === 'string' && payload.encryptkey) {
      return payload.encryptkey;
    }
    return null;
  }

  /** The bytes of a picture of the EZVIZ cloud (https only). */
  async download(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new EzvizError(ERROR_KINDS.API, 'Picture: invalid address');
    }
    if (parsed.protocol !== 'https:') {
      throw new EzvizError(ERROR_KINDS.API, 'Picture: not an https address');
    }
    const response = await this.send({ method: 'GET', url: parsed.toString() });
    if (response.status !== 200 || response.body.length === 0) {
      throw new EzvizError(ERROR_KINDS.API, `Picture: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    return response.body;
  }
}
