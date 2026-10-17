// -----------------------------------------------------------------------------
// The hub against the fake EZVIZ cloud: session, verification code, alarms
// and their scene events, pictures (plain and encrypted), commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encryptPicture } from '../src/ezviz/crypto.js';
import { TRIGGERS } from '../src/hub.js';
import {
  BASE_CONFIG,
  CODE,
  FakeCloud,
  SERIALS,
  USER,
  VERIFICATION_CODE,
  cameraIds,
  createAll,
  createWorld,
  discovered,
  settle,
} from './helpers/world.js';
import { JPEG } from './helpers/fakeCloud.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const captures = (w) => w.cloud.requests.filter((r) => r.path.endsWith('/capture'));
const logins = (w) => w.cloud.calls('/v3/users/login/v5').length;

test('the start: login, devices discovered, connected; the session saved in /data', async (t) => {
  const w = await world(t);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(logins(w), 1);
  // Six cameras and the account.
  assert.equal(w.fake.discoveredDevices.length, 7);
  assert.ok(w.fake.discoveredDevices.every((device) => device.should_poll === false));
  await w.app.stop();
  const saved = JSON.parse(readFileSync(join(w.dataDir, 'ezviz-state.json'), 'utf8'));
  assert.match(saved.featureCode, /^[0-9a-f]{32}$/);
  assert.equal(saved.session.user, USER);
  assert.ok(saved.session.sessionId);
  const text = JSON.stringify(saved);
  assert.ok(!text.includes(BASE_CONFIG.password), 'never the password');
  assert.ok(!text.includes(BASE_CONFIG.username), 'never the e-mail');
});

test('a restart reuses the session and the terminal id: no new login', async (t) => {
  const cloud = new FakeCloud();
  const first = await createWorld({ cloud });
  const featureCode = cloud.calls('/v3/users/login/v5')[0].form.featureCode;
  await first.app.stop();
  const second = await world(t, { cloud, dataDir: first.dataDir });
  assert.equal(logins(second), 1, 'still the first login only');
  assert.deepEqual(second.fake.connectionStatus, { connected: true });
  assert.ok(cloud.requests.every((r) => r.headers.featureCode === featureCode));
});

test('another account in the configuration does not reuse the saved session', async (t) => {
  const cloud = new FakeCloud();
  const first = await createWorld({ cloud });
  await first.app.stop();
  cloud.username = 'other@example.com';
  await world(t, {
    cloud,
    dataDir: first.dataDir,
    config: { ...BASE_CONFIG, username: 'other@example.com' },
  });
  assert.equal(logins({ cloud }), 2);
});

test('an expired session is renewed, then the account logs in again', async (t) => {
  const w = await world(t);
  w.cloud.expireSessions();
  assert.equal(await w.hub.refresh(), true);
  assert.equal(w.cloud.calls('/v3/apigateway/login').length, 1);
  assert.equal(logins(w), 1);
  w.cloud.expireSessions({ all: true });
  assert.equal(await w.hub.refresh(), true);
  assert.equal(logins(w), 2);
});

test('a wrong password is tried once: no automatic retry, until the user acts', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, password: 'wrong-password-value' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /refused the e-mail or the password/);
  for (let i = 0; i < 5; i += 1) {
    await w.hub.refresh();
    await w.hub.checkAlarms();
  }
  assert.equal(logins(w), 1, 'one attempt only: EZVIZ locks accounts');
  // "Test the connection" tries once more.
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /refused the e-mail or the password/);
  assert.equal(logins(w), 2);
  // The right password in the configuration: connected.
  await w.fake.configUpdated({ ...BASE_CONFIG });
  await settle();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('two-step verification: the code typed in the action connects the account', async (t) => {
  const cloud = new FakeCloud();
  cloud.mfa = true;
  const w = await world(t, { cloud });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /verification code/);
  assert.equal(cloud.codesSent, 1);
  await w.hub.refresh();
  assert.equal(logins(w), 1, 'no new login, no new code while waiting');
  assert.equal(cloud.codesSent, 1);

  // An empty code asks for a new one.
  let ack = await w.fake.action('verify_code', {});
  assert.match(ack.data.message.en, /new verification code/);
  assert.equal(cloud.codesSent, 2);
  ack = await w.fake.action('verify_code', { code: '000000' });
  assert.match(ack.data.message.en, /refused or expired/);
  ack = await w.fake.action('verify_code', { code: ` ${CODE} ` });
  assert.match(ack.data.message.en, /Code accepted/);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.discoveredDevices.length, 7);
  ack = await w.fake.action('verify_code', {});
  assert.match(ack.data.message.en, /No verification code is needed/);
});

test('the account of another region is found, and the configuration says what is wrong', async (t) => {
  const cloud = new FakeCloud();
  cloud.region = 'apiius.ezvizlife.com';
  const w = await world(t, { cloud });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /apiius\.ezvizlife\.com\): 6 camera/);
  assert.match(ack.data.message.en, /6 camera\(s\) encrypt their pictures/);

  const empty = await world(t, { config: { language: 'fr' } });
  assert.match(empty.fake.connectionStatus.message.fr, /e-mail et le mot de passe/);
  assert.deepEqual(empty.fake.discoveredDevices, []);
  const invalid = await world(t, { config: { ...BASE_CONFIG, api_server: 'evil.example.com' } });
  assert.match(invalid.fake.connectionStatus.message.en, /API server not understood/);
  assert.equal(invalid.cloud.requests.length, 0, 'nothing sent anywhere');
});

test('the alarms before the start fire nothing, but give the last event and image', async (t) => {
  const w = await world(t);
  await createAll(w);
  await w.hub.checkAlarms();
  assert.deepEqual(w.fake.sceneEvents, []);
  const ptz = cameraIds(w.gladys, SERIALS.PTZ);
  assert.match(w.fake.lastState(ptz.feature('last_event')), /^Motion · /);
  assert.equal(w.fake.lastState(ptz.feature('motion')), 0);
  assert.ok(w.fake.cameraImages.some((image) => image.device_external_id === ptz.device));
});

test('a new detection: motion pulse, picture, then the scene event', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ptz = cameraIds(w.gladys, SERIALS.PTZ);
  const images = w.fake.cameraImages.length;
  w.cloud.addAlarm(SERIALS.PTZ, {
    at: w.clock.now() - 4000,
    title: 'Human shape detected',
    type: '10029',
  });
  await w.hub.checkAlarms();
  assert.equal(w.fake.lastState(ptz.feature('motion')), 1);
  assert.match(w.fake.lastState(ptz.feature('last_event')), /^Person · /);
  assert.equal(w.fake.cameraImages.length, images + 1, 'the picture of the alarm');
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.DETECTION,
      data: {
        camera: ptz.device,
        kind: 'person',
        camera_name: 'Living room',
        kind_name: 'Person',
        alarm_name: 'Human shape detected',
        alarm_code: '10029',
      },
    },
  ]);
  // The image was sent before the event (the request log keeps the order).
  const order = w.fake.requests
    .map((r) => r.path)
    .filter((path) => path.includes('camera/image') || path.includes('scene/event'));
  assert.ok(order.at(-1).includes('scene/event'), order.join(' '));
  assert.ok(order.at(-2).includes('camera/image'), order.join(' '));

  // The same alarm read again fires nothing; motion falls back after a while.
  await w.hub.checkAlarms();
  assert.equal(w.fake.sceneEvents.length, 1);
  await sleep(80);
  await settle();
  assert.equal(w.fake.lastState(ptz.feature('motion')), 0);
});

test('scene variables name the camera as in Gladys', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ptz = discovered(w, SERIALS.PTZ);
  await w.fake.deviceUpdated({ ...ptz, name: 'Babyphone Léa' });
  w.cloud.addAlarm(SERIALS.PTZ, { at: w.clock.now() });
  await w.hub.checkAlarms();
  assert.equal(w.fake.sceneEvents.at(-1).data.camera_name, 'Babyphone Léa');
});

test('the doorbell: ring pulse and its own scene event', async (t) => {
  const w = await world(t);
  await createAll(w);
  const doorbell = cameraIds(w.gladys, SERIALS.DOORBELL);
  w.cloud.addAlarm(SERIALS.DOORBELL, {
    at: w.clock.now(),
    title: 'Someone is calling',
    type: '10016',
  });
  await w.hub.checkAlarms();
  assert.equal(w.fake.lastState(doorbell.feature('ring')), 1);
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: TRIGGERS.DOORBELL,
      data: { doorbell: doorbell.device, doorbell_name: 'Front door' },
    },
  ]);
  await sleep(80);
  await settle();
  assert.equal(w.fake.lastState(doorbell.feature('ring')), 0);
});

test('a camera that rings becomes a doorbell, and stays one after a restart', async (t) => {
  const cloud = new FakeCloud();
  const w = await createWorld({ cloud });
  await createAll(w);
  const before = discovered(w, SERIALS.DRIVEWAY).features.map((f) => f.external_id);
  assert.ok(!before.some((id) => id.endsWith(':ring')));
  cloud.addAlarm(SERIALS.DRIVEWAY, { at: w.clock.now(), title: 'Doorbell call', type: '' });
  await w.hub.checkAlarms();
  assert.ok(discovered(w, SERIALS.DRIVEWAY).features.some((f) => f.external_id.endsWith(':ring')));
  await w.app.stop();
  const again = await world(t, { cloud, dataDir: w.dataDir });
  assert.ok(
    discovered(again, SERIALS.DRIVEWAY).features.some((f) => f.external_id.endsWith(':ring')),
  );
});

test('an alarm listed late shows as the last event, but fires nothing', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.addAlarm(SERIALS.PTZ, { at: w.clock.now() - 30 * 60_000 });
  await w.hub.checkAlarms();
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('encrypted pictures: the code of the configuration, else the key of the cloud', async (t) => {
  const cloud = new FakeCloud();
  cloud.encryptedSerials.add(SERIALS.PTZ);
  const w = await world(t, {
    cloud,
    config: { ...BASE_CONFIG, verification_codes: `${SERIALS.PTZ}:${VERIFICATION_CODE}` },
  });
  await createAll(w);
  const ptz = cameraIds(w.gladys, SERIALS.PTZ);
  w.cloud.addAlarm(SERIALS.PTZ, { at: w.clock.now() });
  await w.hub.checkAlarms();
  const image = w.fake.cameraImages
    .filter((entry) => entry.device_external_id === ptz.device)
    .at(-1);
  assert.equal(image.image, `image/jpg;base64,${JPEG.toString('base64')}`);

  // No code in the configuration: the key the cloud keeps.
  const other = new FakeCloud();
  other.encryptedSerials.add(SERIALS.PTZ);
  other.cloudKey = VERIFICATION_CODE;
  const w2 = await world(t, { cloud: other });
  await createAll(w2);
  other.addAlarm(SERIALS.PTZ, { at: w2.clock.now() });
  await w2.hub.checkAlarms();
  const decrypted = w2.fake.cameraImages
    .filter((entry) => entry.device_external_id === ptz.device)
    .at(-1);
  assert.equal(decrypted.image, `image/jpg;base64,${JPEG.toString('base64')}`);

  // Neither: no image, the scene event still fires.
  const none = new FakeCloud();
  none.encryptedSerials.add(SERIALS.PTZ);
  const w3 = await world(t, { cloud: none });
  await createAll(w3);
  const count = w3.fake.cameraImages.filter(
    (entry) => entry.device_external_id === ptz.device,
  ).length;
  none.addAlarm(SERIALS.PTZ, { at: w3.clock.now() });
  await w3.hub.checkAlarms();
  assert.equal(
    w3.fake.cameraImages.filter((entry) => entry.device_external_id === ptz.device).length,
    count,
  );
  assert.equal(w3.fake.sceneEvents.length, 1);
  assert.ok(encryptPicture(JPEG, VERIFICATION_CODE).length > JPEG.length);
});

test('Gladys asking for a live image gets a fresh capture; an asleep camera its last picture', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ptz = discovered(w, SERIALS.PTZ);
  w.clock.advance(40_000); // the image of the start is older than 30 s
  const ack = await w.fake.getImage(ptz);
  assert.equal(ack.success, true);
  assert.match(ack.data.image, /^image\/jpg;base64,/);
  assert.ok(captures(w).some((r) => r.path.includes(SERIALS.PTZ)));
  // The battery camera is asleep: no capture, its last alarm picture... none here.
  const battery = discovered(w, SERIALS.BATTERY);
  const failed = await w.fake.getImage(battery);
  assert.equal(failed.success, false);
  assert.match(failed.error, /asleep or offline/);
  w.cloud.addAlarm(SERIALS.BATTERY, { at: w.clock.now() });
  await w.hub.checkAlarms();
  const last = await w.fake.getImage(battery);
  assert.equal(last.success, true);
});

test('"send the camera image" right after an alarm sends the alarm picture', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.clock.advance(5 * 60_000);
  w.cloud.addAlarm(SERIALS.FLOODLIGHT, { at: w.clock.now() });
  await w.hub.checkAlarms();
  const alarmImage = w.fake.cameraImages.at(-1).image;
  const before = captures(w).length;
  w.clock.advance(20_000); // the scene runs: within 30 s
  const ack = await w.fake.getImage(discovered(w, SERIALS.FLOODLIGHT));
  assert.equal(ack.data.image, alarmImage);
  assert.equal(captures(w).length, before, 'no capture: the alarm picture is sent');
});

test('the verification code of a camera, saved by the action, checked on its last picture', async (t) => {
  const cloud = new FakeCloud();
  cloud.encryptedSerials.add(SERIALS.PTZ);
  cloud.encryptedSerials.add(SERIALS.DRIVEWAY);
  const w = await world(t, { cloud });
  await createAll(w);
  const ptz = cameraIds(w.gladys, SERIALS.PTZ).device;
  // The alarm of the fixture is plain: a new, encrypted one.
  cloud.addAlarm(SERIALS.PTZ, { at: w.clock.now() });
  cloud.addAlarm(SERIALS.DRIVEWAY, { at: w.clock.now() });
  await w.hub.checkAlarms();

  let ack = await w.fake.action('camera_code', { camera: ptz, code: ' ABCDEF ' });
  assert.equal(
    ack.data.message.fr,
    'Code de vérification enregistré pour Living room : il ouvre sa dernière image.',
  );
  // The picture it opens is shown at once.
  await settle();
  const image = w.fake.cameraImages.filter((entry) => entry.device_external_id === ptz).at(-1);
  assert.equal(image.image, `image/jpg;base64,${JPEG.toString('base64')}`);
  // Kept in /data, used for the RTSP address; never in the logs (see logs.test.js).
  await w.app.stop();
  const saved = JSON.parse(readFileSync(join(w.dataDir, 'ezviz-state.json'), 'utf8'));
  assert.deepEqual(saved.codes, { [SERIALS.PTZ]: 'ABCDEF' });

  const again = await world(t, { cloud, dataDir: w.dataDir });
  await createAll(again);
  ack = await again.fake.action('stream_url', { camera: ptz });
  assert.match(ack.data.message.en, /rtsp:\/\/admin:ABCDEF@/);
  const driveway = cameraIds(again.gladys, SERIALS.DRIVEWAY).device;
  ack = await again.fake.action('camera_code', { camera: driveway, code: 'QWERTY' });
  assert.match(ack.data.message.en, /does not open its last picture/);
  ack = await again.fake.action('camera_code', { camera: driveway, code: 'not a code!' });
  assert.match(ack.data.message.en, /letters and digits/);
  ack = await again.fake.action('camera_code', { camera: driveway });
  assert.equal(ack.data.message.en, 'Verification code removed for Driveway.');
  ack = await again.fake.action('camera_code', {
    camera: cameraIds(again.gladys, SERIALS.GARAGE).device,
    code: 'ABCDEF',
  });
  assert.equal(
    ack.data.message.en,
    'Verification code saved for Garage.',
    'nothing to check it on',
  );
  ack = await again.fake.action('camera_code', { code: 'ABCDEF' });
  assert.equal(ack.success, false);
});

test('several codes without a serial number are not applied: the cameras are listed', async (t) => {
  const cloud = new FakeCloud();
  cloud.encryptedSerials.add(SERIALS.PTZ);
  const w = await world(t, {
    cloud,
    config: { ...BASE_CONFIG, verification_codes: `QWERTY,${VERIFICATION_CODE}` },
  });
  await createAll(w);
  const status = w.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(
    status.message.fr,
    /Plusieurs codes de vérification sans numéro de série sont ignorés/,
  );
  assert.match(status.message.en, /Living room \(EZFAKE004\), Back door \(EZFAKE006\)/);
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /Your cameras: Garden floodlight \(EZFAKE001\)/);
  // Not even the right one is tried on the camera: no image from it.
  const ptz = cameraIds(w.gladys, SERIALS.PTZ).device;
  const count = w.fake.cameraImages.filter((entry) => entry.device_external_id === ptz).length;
  cloud.addAlarm(SERIALS.PTZ, { at: w.clock.now() });
  await w.hub.checkAlarms();
  assert.equal(
    w.fake.cameraImages.filter((entry) => entry.device_external_id === ptz).length,
    count,
  );
  const rtsp = await w.fake.action('stream_url', { camera: ptz });
  assert.match(rtsp.data.message.en, /Set a camera verification code/);
  // A code saved through the action: that camera leaves the list.
  await w.fake.action('camera_code', { camera: ptz, code: VERIFICATION_CODE });
  assert.ok(!w.fake.connectionStatus.message.en.includes('EZFAKE004'));
  assert.match(w.fake.connectionStatus.message.en, /Garage \(EZFAKE010\)/);
  // Every camera with its code, or the field emptied: the message goes away.
  for (const serial of Object.values(SERIALS)) {
    await w.fake.action('camera_code', {
      camera: cameraIds(w.gladys, serial).device,
      code: 'ABCDEF',
    });
  }
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  await w.fake.configUpdated({ ...BASE_CONFIG, verification_codes: '' });
  await settle();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the periodic captures skip the battery cameras, the offline ones, privacy and sleep', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.setSwitch(SERIALS.DRIVEWAY, 21, true);
  await w.hub.refresh();
  w.clock.advance(60 * 60_000);
  const before = captures(w).length;
  await w.hub.snapshotAll();
  const serials = captures(w)
    .slice(before)
    .map((r) => r.path.split('/')[4]);
  // The C6CN has its privacy mode on, the H9c is asleep, the EB3 runs on
  // battery, the Husky is offline.
  assert.deepEqual(serials.sort(), [SERIALS.FLOODLIGHT, SERIALS.DOORBELL].sort());
});

test('commands: privacy, detection, floodlight, siren, pan/tilt', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ptz = discovered(w, SERIALS.PTZ);
  const feature = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

  assert.equal((await w.fake.setValue(ptz, feature(ptz, 'privacy'), 0)).success, true);
  assert.equal(w.fake.lastState(feature(ptz, 'privacy').external_id), 0);
  assert.equal(w.cloud.devices.SWITCH[SERIALS.PTZ].find((s) => s.type === 7).enable, false);

  assert.equal((await w.fake.setValue(ptz, feature(ptz, 'detection'), 0)).success, true);
  assert.equal(w.cloud.devices.STATUS[SERIALS.PTZ].globalStatus, 0);
  assert.equal(w.fake.lastState(feature(ptz, 'detection').external_id), 0);

  assert.equal((await w.fake.setValue(ptz, feature(ptz, 'move'), 3)).success, true);
  assert.deepEqual(
    w.cloud.calls('ptzControl').map((r) => r.form.command),
    ['UP', 'UP'],
  );
  // 0 is "stop": nothing to send, EZVIZ moves one step per command.
  assert.equal((await w.fake.setValue(ptz, feature(ptz, 'move'), 0)).success, true);
  assert.equal(w.cloud.calls('ptzControl').length, 2);

  const floodlight = discovered(w, SERIALS.FLOODLIGHT);
  assert.equal((await w.fake.setValue(floodlight, feature(floodlight, 'light'), 1)).success, true);
  assert.equal(w.fake.lastState(feature(floodlight, 'light').external_id), 1);
  assert.equal(w.cloud.devices.SWITCH[SERIALS.FLOODLIGHT].find((s) => s.type === 303).enable, true);

  assert.equal((await w.fake.setValue(floodlight, feature(floodlight, 'siren'), 1)).success, true);
  assert.equal(w.fake.lastState(feature(floodlight, 'siren').external_id), 1);
  await sleep(80); // the firmware stops it after a minute
  await settle();
  assert.equal(w.fake.lastState(feature(floodlight, 'siren').external_id), 0);

  // Online is read-only.
  const refused = await w.fake.setValue(ptz, feature(ptz, 'online'), 1);
  assert.equal(refused.success, false);
});

test('a command wins over a device list read right after it', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ptz = discovered(w, SERIALS.PTZ);
  const privacy = ptz.features.find((f) => f.external_id.endsWith(':privacy'));
  await w.fake.setValue(ptz, privacy, 0);
  // The cloud still reports the old state for a moment.
  w.cloud.setSwitch(SERIALS.PTZ, 7, true);
  await w.hub.refresh();
  assert.equal(w.fake.lastState(privacy.external_id), 0);
  w.clock.advance(2 * 60_000);
  await w.hub.refresh();
  assert.equal(w.fake.lastState(privacy.external_id), 1);
});

test('the siren is not offered unless allowed', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, allow_siren: false } });
  for (const device of w.fake.discoveredDevices) {
    assert.ok(!device.features.some((f) => f.external_id.endsWith(':siren')), device.name);
  }
});

test('the arming mode: read, set from Gladys, refused when not allowed', async (t) => {
  const w = await world(t);
  await createAll(w);
  const account = discovered(w, 'account');
  const mode = account.features[0];
  assert.equal(mode.read_only, false);
  assert.equal(w.fake.lastState(mode.external_id), 'away');
  assert.equal((await w.fake.setValue(account, mode, 'sleep')).success, true);
  assert.equal(w.cloud.mode, 3);
  assert.equal(w.fake.lastState(mode.external_id), 'sleep');

  const locked = await world(t, { config: { ...BASE_CONFIG, allow_arming: false } });
  await createAll(locked);
  const lockedAccount = discovered(locked, 'account');
  assert.equal(lockedAccount.features[0].read_only, true);
  const refused = await locked.fake.setValue(lockedAccount, lockedAccount.features[0], 'home');
  assert.equal(refused.success, false);
  assert.match(refused.error, /disabled/);
  assert.equal(locked.cloud.mode, 2);
});

test('a camera going offline: transport unreachable; the cloud lost: every camera', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ptz = cameraIds(w.gladys, SERIALS.PTZ).device;
  const transport = (id) =>
    w.fake.transports.filter((entry) => entry.device_external_id === id).at(-1);
  assert.equal(transport(ptz).transport, 'cloud');
  assert.equal(transport(cameraIds(w.gladys, SERIALS.GARAGE).device).transport, 'unreachable');
  w.cloud.info(SERIALS.PTZ).status = 2;
  await w.hub.refresh();
  assert.equal(transport(ptz).transport, 'unreachable');
  assert.equal(w.fake.lastState(cameraIds(w.gladys, SERIALS.PTZ).feature('online')), 0);
  w.cloud.info(SERIALS.PTZ).status = 1;
  w.cloud.online = false;
  await w.hub.refresh();
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  w.cloud.online = true;
  await w.hub.refresh();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(transport(ptz).transport, 'cloud');
});

test('the RTSP address: with the verification code, shown and never logged', async (t) => {
  const w = await world(t, {
    config: { ...BASE_CONFIG, verification_codes: `${SERIALS.PTZ}:${VERIFICATION_CODE}` },
  });
  await createAll(w);
  let ack = await w.fake.action('stream_url', { camera: cameraIds(w.gladys, SERIALS.PTZ).device });
  assert.match(
    ack.data.message.en,
    /rtsp:\/\/admin:ABCDEF@192\.0\.2\.23:554\/Streaming\/Channels\/101$/,
  );
  ack = await w.fake.action('stream_url', { camera: cameraIds(w.gladys, SERIALS.DRIVEWAY).device });
  assert.match(ack.data.message.en, /verification code of this camera/);
  ack = await w.fake.action('stream_url', {});
  assert.equal(ack.success, false);
});

test('the live view: CAMERA_URL on the cameras whose local address and code are known', async (t) => {
  const w = await world(t, {
    config: { ...BASE_CONFIG, verification_codes: `${SERIALS.PTZ}:${VERIFICATION_CODE}` },
  });
  // The core's rtsp-camera service plays this param in the dashboard camera box.
  assert.deepEqual(discovered(w, SERIALS.PTZ).params, [
    {
      name: 'CAMERA_URL',
      value: 'rtsp://admin:ABCDEF@192.0.2.23:554/Streaming/Channels/101',
    },
  ]);
  // Without its verification code: no live view, no param.
  assert.equal(discovered(w, SERIALS.DRIVEWAY).params, undefined);
});

test('a device added later receives its values and its image at once', async (t) => {
  const w = await world(t);
  await w.hub.checkAlarms();
  assert.equal(w.fake.states.length, 0, 'nothing for devices not added');
  const ptz = discovered(w, SERIALS.PTZ);
  await w.fake.deviceCreated(ptz);
  await settle();
  const ids = cameraIds(w.gladys, SERIALS.PTZ);
  assert.equal(w.fake.lastState(ids.feature('online')), 1);
  assert.equal(w.fake.lastState(ids.feature('sd_capacity')), 58);
  assert.equal(w.fake.lastState(ids.feature('sd_state')), 'Normal');
  assert.ok(w.fake.cameraImages.some((image) => image.device_external_id === ids.device));
  assert.ok(w.fake.widgetRefreshes.length > 0);
});

test('a scan publishes the devices again; onPoll only reads the alarms', async (t) => {
  const w = await world(t);
  const lists = w.cloud.calls('pagelist').length;
  await w.fake.scanRequest();
  assert.equal(w.cloud.calls('pagelist').length, lists + 1);
  await createAll(w);
  const ack = await w.fake.poll(discovered(w, SERIALS.PTZ));
  assert.equal(ack.success, true);
  assert.equal(w.cloud.calls('pagelist').length, lists + 1);
});

test('sleep mode: a switch on the cameras that announce it, and the scene action', async (t) => {
  const w = await world(t);
  await createAll(w);
  const feature = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
  const floodlight = discovered(w, SERIALS.FLOODLIGHT);
  assert.ok(feature(floodlight, 'sleep'), 'the LC1C announces SupportSleep');
  assert.equal(feature(discovered(w, SERIALS.PTZ), 'sleep'), undefined, 'the C6CN does not');
  assert.equal(w.fake.lastState(feature(floodlight, 'sleep').external_id), 0);

  assert.equal((await w.fake.setValue(floodlight, feature(floodlight, 'sleep'), 1)).success, true);
  assert.equal(w.cloud.devices.SWITCH[SERIALS.FLOODLIGHT].find((s) => s.type === 21).enable, true);
  assert.equal(w.fake.lastState(feature(floodlight, 'sleep').external_id), 1);

  // The scene action: sleep mode, else privacy mode (the C6CN).
  const wake = await w.fake.sceneAction('set_camera_sleep', {
    camera: cameraIds(w.gladys, SERIALS.FLOODLIGHT).device,
    state: 'wake',
  });
  assert.equal(wake.success, true, wake.error);
  assert.equal(w.cloud.devices.SWITCH[SERIALS.FLOODLIGHT].find((s) => s.type === 21).enable, false);
  assert.equal(w.fake.lastState(feature(floodlight, 'sleep').external_id), 0);
  const ptz = discovered(w, SERIALS.PTZ);
  const lens = await w.fake.sceneAction('set_camera_sleep', {
    camera: ptz.external_id,
    state: 'wake',
  });
  assert.equal(lens.success, true, lens.error);
  assert.equal(w.cloud.devices.SWITCH[SERIALS.PTZ].find((s) => s.type === 7).enable, false);
  assert.equal(w.fake.lastState(feature(ptz, 'privacy').external_id), 0);

  // A camera with neither, an unknown state: a clear error for the scene log.
  const none = await w.fake.sceneAction('set_camera_sleep', {
    camera: cameraIds(w.gladys, SERIALS.BATTERY).device,
    state: 'sleep',
  });
  assert.equal(none.success, false);
  assert.match(none.error, /neither a sleep mode nor a privacy mode/);
  const odd = await w.fake.sceneAction('set_camera_sleep', { camera: ptz.external_id, state: 'x' });
  assert.equal(odd.success, false);
});
