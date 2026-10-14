// -----------------------------------------------------------------------------
// The timers of the container. Gladys never polls a device published with
// should_poll: false (and never polls the devices created without should_poll,
// GladysAssistant/Gladys#3198): the cloud must be read by the hub's own
// timers, with no onPoll at all — the alarms at the interval of the
// configuration, the devices every 5 minutes, the captures on their timer.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_TIMINGS } from '../src/hub.js';
import {
  BASE_CONFIG,
  SERIALS,
  cameraIds,
  createAll,
  createWorld,
  settle,
} from './helpers/world.js';

async function timedWorld(t, options = {}) {
  t.mock.timers.enable({
    apis: ['setTimeout', 'setInterval', 'Date'],
    now: Date.UTC(2026, 9, 14, 12),
  });
  // The hub reads the mocked clock, which the ticks move.
  const clock = { now: () => Date.now() };
  const w = await createWorld({ timers: true, clock, ...options });
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

async function tick(t, ms) {
  t.mock.timers.tick(ms);
  await settle(60);
}

const count = (w, fragment) => w.cloud.requests.filter((r) => r.path.endsWith(fragment)).length;

test('the alarms are read on the internal timer, without any onPoll from Gladys', async (t) => {
  const w = await timedWorld(t);
  assert.ok(w.fake.discoveredDevices.every((device) => device.should_poll === false));
  const before = count(w, '/unifiedmsg/list');
  w.cloud.addAlarm(SERIALS.PTZ, { at: Date.now(), title: 'Person detected' });
  await tick(t, 30_000);
  assert.equal(count(w, '/unifiedmsg/list') - before, 1);
  assert.equal(w.fake.sceneEvents.length, 1, 'the scene event, from the timer');
  assert.equal(w.fake.lastState(cameraIds(w.gladys, SERIALS.PTZ).feature('motion')), 1);
  await tick(t, 30_000);
  assert.equal(count(w, '/unifiedmsg/list') - before, 2);
  // The test never calls fake.poll(): every read came from the timers.
});

test('the alarm interval of the configuration is followed', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, alarm_interval: '120' } });
  const before = count(w, '/unifiedmsg/list');
  await tick(t, 60_000);
  assert.equal(count(w, '/unifiedmsg/list'), before);
  await tick(t, 60_000);
  assert.equal(count(w, '/unifiedmsg/list') - before, 1);
});

test('the device list is read again every 5 minutes: a change in the app shows up', async (t) => {
  const w = await timedWorld(t);
  const privacy = cameraIds(w.gladys, SERIALS.PTZ).feature('privacy');
  assert.equal(w.fake.lastState(privacy), 1);
  const before = count(w, '/resources/pagelist');
  w.cloud.setSwitch(SERIALS.PTZ, 7, false);
  await tick(t, HUB_TIMINGS.refreshMs);
  assert.equal(count(w, '/resources/pagelist') - before, 1);
  assert.equal(w.fake.lastState(privacy), 0);
});

test('captures follow the interval of the configuration; none when "only on alarm"', async (t) => {
  const w = await timedWorld(t);
  const before = count(w, '/capture');
  await tick(t, 15 * 60_000);
  // Three mains-powered cameras online, without privacy mode.
  assert.equal(count(w, '/capture') - before, 3);
  t.mock.timers.reset();
});

test('no periodic capture when the configuration says "only on alarm"', async (t) => {
  const w = await timedWorld(t, { config: { ...BASE_CONFIG, snapshot_interval: '0' } });
  const before = count(w, '/capture');
  await tick(t, 60 * 60_000);
  assert.equal(count(w, '/capture'), before);
});

test('the timers stop with the integration', async (t) => {
  const w = await timedWorld(t);
  await w.app.stop();
  const requests = w.cloud.requests.length;
  await tick(t, 60 * 60_000);
  assert.equal(w.cloud.requests.length, requests);
});
