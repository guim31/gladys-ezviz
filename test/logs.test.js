// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal cycle — alarm reads, alarms, pictures, captures, device list
// reads — writes nothing; a failure that repeats is logged once, and its end
// once. Never the password, the e-mail, a session, a verification code, a
// picture address or a stream address — at any level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_CONFIG,
  CODE,
  FakeCloud,
  PASSWORD,
  SERIALS,
  USERNAME,
  VERIFICATION_CODE,
  cameraIds,
  createAll,
  createWorld,
  discovered,
  settle,
} from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

/** Every secret the logs must never hold, with the sessions the cloud gave. */
function secrets(w) {
  return [
    PASSWORD,
    USERNAME,
    VERIFICATION_CODE,
    'pictures.ezviz.test',
    ...w.cloud.sessions,
    ...w.cloud.refreshIds,
  ];
}

function assertNoSecret(w, logs) {
  const text = logs.texts().join('\n');
  for (const secret of secrets(w)) {
    assert.ok(!text.includes(secret), `the logs hold "${secret}"`);
  }
}

test('a normal cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: { ...BASE_CONFIG, verification_codes: `${SERIALS.PTZ}:${VERIFICATION_CODE}` },
  });
  assert.ok(
    logs
      .texts()
      .some((text) => text.includes('Connected to the EZVIZ cloud (apiieu.ezvizlife.com)')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();

  for (let i = 0; i < 3; i += 1) {
    w.cloud.addAlarm(SERIALS.PTZ, { at: w.clock.now(), title: 'Person detected', type: '' });
    w.cloud.addAlarm(SERIALS.DOORBELL, { at: w.clock.now(), type: '10016' });
    await w.hub.checkAlarms();
    w.clock.advance(5 * 60_000);
    await w.hub.refresh();
    await w.hub.snapshotAll();
    await w.fake.getImage(discovered(w, SERIALS.FLOODLIGHT));
  }
  // The battery camera wakes up and sleeps again: not news either.
  w.cloud.info(SERIALS.BATTERY).status = 1;
  await w.hub.refresh();
  w.cloud.info(SERIALS.BATTERY).status = 2;
  await w.hub.refresh();
  await sleep(80); // the pulses end
  await settle();
  assert.deepEqual(logs.texts(), []);
});

test('a cloud that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.cloud.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
    await w.hub.checkAlarms();
  }
  const lines = logs.texts();
  assert.equal(lines.filter((text) => text.includes('Cannot read the EZVIZ cloud')).length, 1);
  assert.equal(lines.filter((text) => text.includes('Cannot read the EZVIZ alarms')).length, 1);
  assert.equal(lines.length, 2, lines.join('\n'));

  logs.clear();
  w.cloud.online = true;
  await w.hub.refresh();
  await w.hub.checkAlarms();
  const back = logs.texts();
  assert.equal(back.filter((text) => /answers again after \d+ min/.test(text)).length, 1);
  assert.equal(back.filter((text) => text.includes('read again')).length, 1);
  assert.equal(back.length, 2, back.join('\n'));
});

test('a refused password is logged once, its repeats only at debug; never the password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { ...BASE_CONFIG, password: 'wrong-password-value' } });
  for (let i = 0; i < 5; i += 1) {
    await w.hub.refresh();
    await w.hub.checkAlarms();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(warnings[0].text, /EZVIZ login refused: Wrong password \(code 1014\)/);
  assert.ok(!logs.texts().join('\n').includes('wrong-password-value'), 'never the password');
  assertNoSecret(w, logs);
});

test('a verification code: one line to ask for it, one when accepted; never the code', async (t) => {
  const logs = captureLogs(t);
  const cloud = new FakeCloud();
  cloud.mfa = true;
  const w = await world(t, { cloud });
  await w.hub.refresh();
  assert.equal(logs.texts().filter((text) => text.includes('verification code')).length, 1);
  logs.clear();
  await w.fake.action('verify_code', { code: CODE });
  const lines = logs.texts();
  assert.ok(lines.some((text) => text.includes('Logged in to the EZVIZ account')));
  assert.ok(lines.some((text) => text.includes('Connected to the EZVIZ cloud')));
  assert.ok(!lines.join('\n').includes(CODE), 'never the code');
  assertNoSecret(w, logs);
});

test('a camera that stops sending pictures is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.cloud.captureStatus = 500;
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(30 * 60_000);
    await w.hub.snapshotAll();
  }
  const failing = logs.texts();
  // One line per mains-powered camera online and without privacy mode: three.
  assert.equal(failing.length, 3, failing.join('\n'));
  assert.ok(failing.every((text) => text.includes('No capture picture from')));
  logs.clear();
  w.cloud.captureStatus = 200;
  w.clock.advance(30 * 60_000);
  await w.hub.snapshotAll();
  assert.equal(logs.texts().length, 3, logs.texts().join('\n'));
  assert.ok(logs.texts().every((text) => text.includes('back')));
});

test('a user command is one line; the stream address is never logged', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: { ...BASE_CONFIG, verification_codes: VERIFICATION_CODE },
  });
  await createAll(w);
  logs.clear();
  const ptz = discovered(w, SERIALS.PTZ);
  const privacy = ptz.features.find((f) => f.external_id.endsWith(':privacy'));
  await w.fake.setValue(ptz, privacy, 0);
  assert.deepEqual(logs.texts().length, 1);
  assert.match(logs.texts()[0], /Living room: privacy mode off/);
  logs.clear();
  const account = discovered(w, 'account');
  await w.fake.setValue(account, account.features[0], 'home');
  assert.deepEqual(logs.texts().length, 1);
  assert.match(logs.texts()[0], /arming mode set to home/);
  logs.clear();
  await w.fake.action('stream_url', { camera: cameraIds(w.gladys).device });
  assert.equal(logs.texts().length, 1);
  logs.clear();
  await w.fake.action('camera_code', {
    camera: cameraIds(w.gladys).device,
    code: VERIFICATION_CODE,
  });
  assert.equal(logs.texts().length, 1);
  assert.match(logs.texts()[0], /verification code of Living room saved/);
  assertNoSecret(w, logs);
});

test('LOG_LEVEL=debug shows the alarms and the reads; never a secret', async (t) => {
  const logs = captureLogs(t, 'debug');
  const cloud = new FakeCloud();
  cloud.encryptedSerials.add(SERIALS.PTZ);
  const w = await world(t, {
    cloud,
    config: { ...BASE_CONFIG, verification_codes: `${SERIALS.PTZ}:${VERIFICATION_CODE}` },
  });
  await createAll(w);
  w.cloud.addAlarm(SERIALS.PTZ, { at: w.clock.now() });
  await w.hub.checkAlarms();
  w.cloud.expireSessions({ all: true });
  await w.hub.refresh();
  w.cloud.online = false;
  await w.hub.refresh();
  await w.hub.refresh();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*Alarm on Living room: motion \(code 10002/);
  assert.match(text, /\[DEBUG\].*Cannot read the EZVIZ cloud/);
  assert.match(text, /\[DEBUG\].*session expired/);
  assertNoSecret(w, logs);
});
