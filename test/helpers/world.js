// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, the fake EZVIZ cloud, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No periodic timer runs unless `timers: true`
// (with node:test mock timers): the tests read the cloud with
// `world.hub.refresh()` and `world.hub.checkAlarms()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import {
  CODE,
  FakeCloud,
  PASSWORD,
  SERIALS,
  SERVER,
  USER,
  USERNAME,
  VERIFICATION_CODE,
} from './fakeCloud.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const BASE_CONFIG = {
  username: USERNAME,
  password: PASSWORD,
  api_server: SERVER,
  verification_codes: '',
  alarm_interval: '30',
  snapshot_interval: '15',
  allow_arming: true,
  allow_siren: true,
  language: 'en',
};

/** A manual clock, an hour after the alarms of the fixture. */
export function createClock(start = Date.UTC(2026, 9, 14, 12, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Let the handlers and the fake network settle. */
export async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * @param {object} [options]
 * @param {FakeCloud} [options.cloud]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers]
 * @param {object} [options.timings] HUB_TIMINGS overrides
 * @param {string} [options.dataDir] the /data of the container
 */
export async function createWorld({
  clock = createClock(),
  cloud = new FakeCloud(),
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-ezviz-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: cloud.request,
    timers,
    timings: {
      motionMs: 50,
      ringMs: 50,
      sirenMs: 50,
      eventImageWaitMs: 500,
      ...timings,
    },
    now: clock.now,
  });
  const world = {
    gladys,
    fake: gladys.fake,
    cloud,
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle();
  }
  return world;
}

/** External ids of a camera of the fixtures. */
export const cameraIds = (gladys, serial = SERIALS.PTZ) => gladys.externalIds('camera', serial);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await settle();
}

/** The discovered device of a serial (or the account with 'account'). */
export function discovered(world, serial) {
  return world.fake.discoveredDevices.find((device) =>
    serial === 'account'
      ? device.external_id.includes(':account:')
      : device.external_id === cameraIds(world.gladys, serial).device,
  );
}

export { CODE, FakeCloud, PASSWORD, SERIALS, SERVER, USER, USERNAME, VERIFICATION_CODE };
