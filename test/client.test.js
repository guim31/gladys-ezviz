import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, EzvizClient, firstImageUrl } from '../src/ezviz/client.js';
import { passwordDigest } from '../src/ezviz/crypto.js';
import { CODE, FakeCloud, PASSWORD, SERIALS, SERVER, USER, USERNAME } from './helpers/fakeCloud.js';

const FEATURE_CODE = '0123456789abcdef0123456789abcdef';

function client(cloud, options = {}) {
  const sessions = [];
  const c = new EzvizClient({
    server: SERVER,
    featureCode: FEATURE_CODE,
    request: cloud.request,
    onSession: (session) => sessions.push(session),
    ...options,
  });
  return { c, sessions };
}

const credentials = { username: USERNAME, password: PASSWORD };

test('login: the digest of the password, never the password; the session is handed over', async () => {
  const cloud = new FakeCloud();
  const { c, sessions } = client(cloud);
  const session = await c.login(credentials);
  assert.equal(session.user, USER);
  assert.equal(session.apiDomain, SERVER);
  assert.equal(sessions.length, 1);
  const [login] = cloud.calls('/v3/users/login/v5');
  assert.equal(login.form.password, passwordDigest(PASSWORD));
  assert.ok(!JSON.stringify(cloud.requests).includes(PASSWORD));
  assert.equal(login.form.featureCode, FEATURE_CODE);
  assert.equal(login.headers.featureCode, FEATURE_CODE);
  assert.equal(login.headers.sessionId, '');
  // The next calls carry the session.
  await c.deviceList();
  assert.equal(cloud.calls('pagelist')[0].headers.sessionId, session.sessionId);
});

test('login: an account of another region is followed there (code 1100)', async () => {
  const cloud = new FakeCloud();
  cloud.region = 'apiius.ezvizlife.com';
  const { c } = client(cloud);
  const session = await c.login(credentials);
  assert.equal(session.apiDomain, 'apiius.ezvizlife.com');
  assert.deepEqual(
    cloud.calls('/v3/users/login/v5').map((r) => r.host),
    [SERVER, 'apiius.ezvizlife.com'],
  );
  await c.deviceList();
  assert.equal(cloud.calls('pagelist')[0].host, 'apiius.ezvizlife.com');
});

test('login: refusals by kind, without the password in the message', async () => {
  const cloud = new FakeCloud();
  const { c } = client(cloud);
  await assert.rejects(c.login({ username: USERNAME, password: 'wrong' }), (err) => {
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.equal(err.code, 1014);
    assert.ok(!err.message.includes('wrong'));
    return true;
  });
  await assert.rejects(c.login({ username: 'nobody@example.com', password: PASSWORD }), {
    kind: ERROR_KINDS.AUTH,
  });
  cloud.locked = true;
  await assert.rejects(c.login(credentials), { kind: ERROR_KINDS.LOCKED });
  cloud.online = false;
  await assert.rejects(c.login(credentials), { kind: ERROR_KINDS.UNREACHABLE });
});

test('two-step verification: a code is sent, then the login takes it', async () => {
  const cloud = new FakeCloud();
  cloud.mfa = true;
  const { c } = client(cloud);
  await assert.rejects(c.login(credentials), { kind: ERROR_KINDS.MFA_REQUIRED });
  assert.equal(cloud.codesSent, 1);
  await assert.rejects(c.login({ ...credentials, code: '000000' }), {
    kind: ERROR_KINDS.MFA_INVALID,
  });
  const session = await c.login({ ...credentials, code: CODE });
  assert.ok(session.sessionId);
  const last = cloud.calls('/v3/users/login/v5').at(-1);
  assert.equal(last.form.msgType, '3');
  assert.equal(last.form.bizType, 'TERMINAL_BIND');
});

test('an expired session is renewed with its refresh id, once', async () => {
  const cloud = new FakeCloud();
  const { c, sessions } = client(cloud);
  await c.login(credentials);
  cloud.expireSessions();
  const list = await c.deviceList();
  assert.equal(list.deviceInfos.length, 6);
  assert.equal(cloud.calls('/v3/apigateway/login').length, 1);
  assert.equal(sessions.length, 2, 'the new session is saved');
  // A refresh id refused too: the caller must log in again.
  cloud.expireSessions({ all: true });
  await assert.rejects(c.deviceList(), { kind: ERROR_KINDS.SESSION });
  assert.equal(c.loggedIn, false);
});

test('a saved session is used without logging in', async () => {
  const cloud = new FakeCloud();
  const { session } = cloud.newSession();
  const { c } = client(cloud, {
    session: { apiDomain: SERVER, sessionId: session, rfSessionId: 'x', user: USER },
  });
  await c.alarms();
  assert.equal(cloud.calls('/v3/users/login/v5').length, 0);
});

test('the device list is read page after page', async () => {
  const cloud = new FakeCloud();
  const { c } = client(cloud);
  await c.login(credentials);
  const full = cloud.devices;
  cloud.api = function (method, path, form) {
    if (path.endsWith('pagelist')) {
      this.pageCalls = (this.pageCalls ?? 0) + 1;
      const first = this.pageCalls === 1;
      const infos = first ? full.deviceInfos.slice(0, 3) : full.deviceInfos.slice(3);
      return {
        status: 200,
        body: Buffer.from(
          JSON.stringify({
            meta: { code: 200 },
            page: { hasNext: first },
            deviceInfos: infos,
            STATUS: Object.fromEntries(
              infos.map((i) => [i.deviceSerial, full.STATUS[i.deviceSerial]]),
            ),
          }),
        ),
      };
    }
    return FakeCloud.prototype.api.call(this, method, path, form);
  };
  const list = await c.deviceList();
  assert.equal(list.deviceInfos.length, 6);
  assert.equal(Object.keys(list.STATUS).length, 6);
  assert.deepEqual(
    cloud.calls('pagelist').map((r) => r.query.offset),
    ['0', '30'],
  );
});

test('reads: alarms of every camera, arming mode', async () => {
  const cloud = new FakeCloud();
  const { c } = client(cloud);
  await c.login(credentials);
  assert.equal((await c.alarms()).length, 2);
  assert.deepEqual(cloud.calls('unifiedmsg')[0].query, { stype: '92', limit: '20', endTime: '' });
  assert.equal(await c.defenceMode(), 2);
});

test('commands: the endpoints of the EZVIZ apps', async () => {
  const cloud = new FakeCloud();
  const { c } = client(cloud);
  await c.login(credentials);
  await c.setDefenceMode(1);
  assert.equal(cloud.mode, 1);
  await c.setSwitch(SERIALS.PTZ, 7, false);
  assert.equal(cloud.devices.SWITCH[SERIALS.PTZ].find((s) => s.type === 7).enable, false);
  // Older firmware: the legacy endpoint.
  cloud.failSwitchV3 = true;
  await c.setSwitch(SERIALS.PTZ, 7, true);
  assert.equal(cloud.calls('/api/device/switchStatus').length, 1);
  assert.equal(cloud.devices.SWITCH[SERIALS.PTZ].find((s) => s.type === 7).enable, true);
  await c.setDetection(SERIALS.PTZ, false);
  assert.equal(cloud.devices.STATUS[SERIALS.PTZ].globalStatus, 0);
  await c.setSiren(SERIALS.FLOODLIGHT, true);
  await c.setSiren(SERIALS.FLOODLIGHT, false);
  assert.deepEqual(
    cloud.calls('sendAlarm').map((r) => r.form.enable),
    ['2', '1'],
  );
  await c.move(SERIALS.PTZ, 'left');
  assert.deepEqual(
    cloud.calls('ptzControl').map((r) => [r.form.command, r.form.action]),
    [
      ['LEFT', 'START'],
      ['LEFT', 'STOP'],
    ],
  );
  const url = await c.capture(SERIALS.PTZ);
  assert.match(url, /^https:\/\/pictures\.ezviz\.test\/captures\//);
  assert.ok((await c.download(url)).length > 1000);
  await assert.rejects(c.capture(SERIALS.BATTERY), { kind: ERROR_KINDS.OFFLINE });
  await assert.rejects(c.download('http://pictures.ezviz.test/x.jpg'), { kind: ERROR_KINDS.API });
  await assert.rejects(c.download('https://pictures.ezviz.test/none.jpg'), {
    kind: ERROR_KINDS.API,
  });
  assert.equal(await c.encryptionKey(SERIALS.PTZ), null, '20002: a code is needed');
  cloud.cloudKey = 'KEYKEY';
  assert.equal(await c.encryptionKey(SERIALS.PTZ), 'KEYKEY');
});

test('errors: no session, an answer that is not JSON, a server error', async () => {
  const cloud = new FakeCloud();
  const { c } = client(cloud);
  await assert.rejects(c.alarms(), { kind: ERROR_KINDS.SESSION });
  await c.login(credentials);
  cloud.api = () => ({ status: 200, body: Buffer.from('<html>') });
  await assert.rejects(c.alarms(), { kind: ERROR_KINDS.API });
  cloud.api = () => ({ status: 503, body: Buffer.alloc(0) });
  await assert.rejects(c.alarms(), { kind: ERROR_KINDS.UNREACHABLE });
  cloud.api = () => ({ status: 200, body: Buffer.from('{"meta":{"code":500}}') });
  await assert.rejects(c.alarms(), (err) => err.kind === ERROR_KINDS.API && err.code === '500');
});

test('the picture address of a capture, whatever the shape of the answer', () => {
  assert.equal(firstImageUrl({ data: { picUrl: 'https://a/1.jpg' } }), 'https://a/1.jpg');
  assert.equal(firstImageUrl({ pics: 'http://a/0.jpg;https://a/2.jpg' }), 'https://a/2.jpg');
  assert.equal(firstImageUrl([{ x: { url: 'https://a/3.jpg' } }]), 'https://a/3.jpg');
  assert.equal(firstImageUrl({ meta: { code: 200 } }), null);
  assert.equal(firstImageUrl(null), null);
});
