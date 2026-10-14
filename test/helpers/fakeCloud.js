// -----------------------------------------------------------------------------
// An in-memory EZVIZ cloud behind the `request` seam of src/ezviz/http.js:
// login (regions, two-step verification, wrong password, locked account),
// session renewal and expiry, the device list of test/fixtures/ezviz, the
// alarm list, the arming mode, the commands, captures and pictures (plain or
// encrypted with the verification code). Every request is recorded.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { encryptPicture } from '../../src/ezviz/crypto.js';
import { NetworkError } from '../../src/ezviz/http.js';

export const USERNAME = 'someone@example.com';
export const PASSWORD = 'correct horse battery staple';
export const CODE = '864213';
export const SERVER = 'apiieu.ezvizlife.com';
export const USER = 'ezvizuser42';
export const VERIFICATION_CODE = 'ABCDEF';

export const SERIALS = Object.freeze({
  FLOODLIGHT: 'EZFAKE001',
  PTZ: 'EZFAKE004',
  BATTERY: 'EZFAKE006',
  DRIVEWAY: 'EZFAKE014',
  GARAGE: 'EZFAKE010',
  DOORBELL: 'EZFAKE021',
});

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/ezviz/${name}`, import.meta.url), 'utf8'));

export const JPEG = readFileSync(new URL('../fixtures/jpeg/420-restart.jpg', import.meta.url));

/** A small plain JPEG, written by jpeg-js. */
export function smallJpeg(width = 64, height = 36, shade = 120) {
  const data = Buffer.alloc(width * height * 4, shade);
  return Buffer.from(jpeg.encode({ width, height, data }, 80).data);
}

const md5 = (value) => createHash('md5').update(value).digest('hex');
const json = (status, body) => ({ status, body: Buffer.from(JSON.stringify(body)) });
const ok = (extra = {}) => json(200, { meta: { code: 200, message: 'ok' }, ...extra });
const meta = (code, extra = {}) => json(200, { meta: { code, message: 'refused' }, ...extra });

export class FakeCloud {
  constructor() {
    this.username = USERNAME;
    this.password = PASSWORD;
    this.region = SERVER; // where the account lives
    this.mfa = false; // two-step verification on the account
    this.locked = false;
    this.online = true;
    this.devices = fixture('pagelist.json');
    this.alarmList = fixture('alarms.json').message;
    this.mode = 2; // away
    this.sessions = new Set();
    this.refreshIds = new Set();
    this.counter = 0;
    this.requests = [];
    this.codesSent = 0;
    // Pictures by URL; the alarm pictures of the fixture exist.
    this.pictures = new Map();
    for (const alarm of this.alarmList) {
      this.pictures.set(alarm.pic, this.picture(alarm.deviceSerial));
    }
    this.captureStatus = 200;
    this.encryptedSerials = new Set();
    this.cloudKey = null; // what /api/device/query/encryptkey answers
    this.failSwitchV3 = false;
    this.request = this.request.bind(this);
  }

  /** The bytes a camera sends: plain, or encrypted with its code. */
  picture(serial) {
    return this.encryptedSerials?.has(serial) ? encryptPicture(JPEG, VERIFICATION_CODE) : JPEG;
  }

  /** A new alarm on a camera, listed first (newest first). */
  addAlarm(serial, { at, title = 'Motion Detection Alarm', type = '10002', id } = {}) {
    this.counter += 1;
    const msgId = id ?? `alarm-${this.counter}-${serial}`;
    const url = `https://pictures.ezviz.test/alarms/${msgId}.jpg`;
    this.pictures.set(url, this.picture(serial));
    this.alarmList.unshift({
      msgId,
      deviceSerial: serial,
      channel: 1,
      time: String(at),
      title,
      subType: '9904',
      pic: url,
      ext: { alarmType: type, pics: url },
    });
    return msgId;
  }

  /** Every session refused from now on (the refresh ids too, with `all`). */
  expireSessions({ all = false } = {}) {
    this.sessions.clear();
    if (all) {
      this.refreshIds.clear();
    }
  }

  newSession() {
    this.counter += 1;
    const session = `session-${this.counter}`;
    const refresh = `refresh-${this.counter}`;
    this.sessions.add(session);
    this.refreshIds.add(refresh);
    return { session, refresh };
  }

  info(serial) {
    return this.devices.deviceInfos.find((info) => info.deviceSerial === serial);
  }

  setSwitch(serial, type, enable) {
    const list = this.devices.SWITCH[serial];
    const item = list.find((entry) => entry.type === type);
    if (item) {
      item.enable = Boolean(enable);
    }
  }

  calls(fragment) {
    return this.requests.filter((r) => r.path.includes(fragment));
  }

  async request({ method, url, headers = {}, form }) {
    const parsed = new URL(url);
    const entry = {
      method,
      host: parsed.hostname,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      form: form ? Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)])) : {},
      headers,
    };
    this.requests.push(entry);
    await Promise.resolve();
    if (!this.online) {
      throw new NetworkError('ENOTFOUND', 'ENOTFOUND');
    }
    if (parsed.hostname === 'pictures.ezviz.test') {
      const bytes = this.pictures.get(url);
      return bytes ? { status: 200, body: bytes } : { status: 404, body: Buffer.alloc(0) };
    }
    return this.route(entry);
  }

  route({ method, host, path, form, headers }) {
    if (method === 'POST' && path === '/v3/users/login/v5') {
      return this.login(host, form);
    }
    if (method === 'POST' && path === '/v3/sms/nologin/checkcode') {
      this.codesSent += 1;
      return ok();
    }
    if (method === 'PUT' && path === '/v3/apigateway/login') {
      if (!this.refreshIds.has(form.refreshSessionId)) {
        return meta(401);
      }
      this.refreshIds.delete(form.refreshSessionId);
      const { session, refresh } = this.newSession();
      return ok({ sessionInfo: { sessionId: session, refreshSessionId: refresh } });
    }
    if (host !== this.region) {
      return { status: 404, body: Buffer.from('not found') };
    }
    if (!this.sessions.has(headers.sessionId)) {
      return { status: 401, body: Buffer.from('{"meta":{"code":401}}') };
    }
    return this.api(method, path, form);
  }

  login(host, form) {
    if (form.account !== this.username) {
      return meta(1013);
    }
    if (form.password !== md5(this.password)) {
      return meta(1014);
    }
    if (this.locked) {
      return meta(1015);
    }
    if (host !== this.region) {
      return meta(1100, { loginArea: { apiDomain: this.region } });
    }
    if (this.mfa) {
      if (!form.smsCode) {
        return meta(6002);
      }
      if (form.smsCode !== CODE) {
        return meta(1012);
      }
    }
    const { session, refresh } = this.newSession();
    return ok({
      loginSession: { sessionId: session, rfSessionId: refresh },
      loginArea: { apiDomain: this.region },
      loginUser: { username: USER },
    });
  }

  api(method, path, form) {
    if (method === 'GET' && path === '/v3/userdevices/v1/resources/pagelist') {
      return ok(structuredClone(this.devices));
    }
    if (method === 'GET' && path === '/v3/unifiedmsg/list') {
      return ok({ message: structuredClone(this.alarmList.slice(0, 20)), hasNext: false });
    }
    if (method === 'GET' && path === '/v3/userdevices/v1/group/defenceMode') {
      return ok({ mode: this.mode });
    }
    if (method === 'POST' && path === '/v3/userdevices/v1/group/switchDefenceMode') {
      this.mode = Number(form.mode);
      return ok();
    }
    if (method === 'POST' && path === '/api/device/query/encryptkey') {
      return this.cloudKey
        ? json(200, { resultCode: '0', encryptkey: this.cloudKey })
        : json(200, { resultCode: '20002' });
    }
    if (method === 'POST' && path === '/api/device/switchStatus') {
      this.setSwitch(form.serial, Number(form.type), form.enable === '1');
      return json(200, { resultCode: '0' });
    }
    let match = path.match(/^\/v3\/devices\/([^/]+)\/(\d+)\/([01])\/(\d+)\/switchStatus$/);
    if (method === 'PUT' && match) {
      if (this.failSwitchV3) {
        return meta(2001);
      }
      this.setSwitch(match[1], Number(match[4]), match[3] === '1');
      return ok();
    }
    match = path.match(/^\/v3\/devices\/([^/]+)\/1\/changeDefenceStatusReq$/);
    if (method === 'PUT' && match) {
      this.devices.STATUS[match[1]].globalStatus = Number(form.status);
      return ok();
    }
    match = path.match(/^\/v3\/devices\/([^/]+)\/0\/sendAlarm$/);
    if (method === 'PUT' && match) {
      return ok();
    }
    match = path.match(/^\/v3\/devices\/([^/]+)\/ptzControl$/);
    if (method === 'PUT' && match) {
      return ok();
    }
    match = path.match(/^\/v3\/devconfig\/v1\/([^/]+)\/1\/capture$/);
    if (method === 'PUT' && match) {
      const serial = match[1];
      if (this.captureStatus !== 200 || this.info(serial)?.status !== 1) {
        return meta(2009);
      }
      this.counter += 1;
      const url = `https://pictures.ezviz.test/captures/${serial}-${this.counter}.jpg`;
      this.pictures.set(url, this.picture(serial));
      return ok({ data: { picUrl: url } });
    }
    return { status: 404, body: Buffer.from('not found') };
  }
}
