// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (the anonymized device list published in the tests of
// pyEzvizApi, test/fixtures/ezviz): a floodlight camera, a pan/tilt camera
// with privacy mode and SD card, a battery camera asleep, a camera offline, a
// doorbell, and the account — after alarms, a ring and commands, in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled and guim31/gladys-unifi-protect.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BASE_CONFIG, SERIALS, createAll, createWorld, discovered } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'English names', language: 'en' },
  { label: 'French names', language: 'fr' },
  { label: 'German names', language: 'de' },
  { label: 'Spanish names', language: 'es' },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({ config: { ...BASE_CONFIG, language: scenario.language } });
    try {
      await createAll(world);
      // Alarms, a ring and commands, so the pulsed and commanded values exist too.
      world.cloud.addAlarm(SERIALS.PTZ, { at: world.clock.now(), title: 'Person detected' });
      world.cloud.addAlarm(SERIALS.DOORBELL, { at: world.clock.now(), type: '10016' });
      await world.hub.checkAlarms();
      const floodlight = discovered(world, SERIALS.FLOODLIGHT);
      for (const key of ['light', 'siren']) {
        const feature = floodlight.features.find((f) => f.external_id.endsWith(`:${key}`));
        await world.fake.setValue(floodlight, feature, 1);
      }

      const devices = world.fake.discoveredDevices;
      // 6 cameras and the account.
      assert.equal(devices.length, 7);
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          assert.equal(typeof feature.keep_history, 'boolean', `${at}: keep_history`);
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: unit ${feature.unit} for ${feature.category}`,
              );
            }
          }
          for (const option of feature.supported_options ?? []) {
            assert.ok(option.label && option.value !== undefined, `${at}: option without label`);
          }

          assert.ok(
            feature.external_id.startsWith(`${device.external_id}:`),
            `${at}: feature id outside its device`,
          );
          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // Every value published fits the declared bounds; images have none.
          if (feature.category === 'camera') {
            continue;
          }
          for (const state of world.fake.states.filter(
            (entry) => entry.device_feature_external_id === feature.external_id,
          )) {
            if (feature.category === 'text') {
              assert.equal(typeof state.text, 'string', `${at}: a text feature receives { text }`);
              assert.ok(state.text.length > 0, `${at}: empty text (Gladys ignores it)`);
              if (feature.type === 'select') {
                assert.ok(
                  feature.supported_options.some((option) => option.value === state.text),
                  `${at}: ${state.text} is not an option`,
                );
              }
              continue;
            }
            const value = state.state;
            assert.equal(typeof value, 'number', `${at}: non-numeric state`);
            assert.ok(
              value >= feature.min && value <= feature.max,
              `${at}: ${value} out of bounds`,
            );
            if (
              feature.type === 'integer' ||
              feature.type === 'binary' ||
              feature.type === 'ring'
            ) {
              assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
            }
          }
        }
      }
    } finally {
      await world.app.stop();
    }
  });
}

test('every feature that has a value received one once the devices are added', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const published = new Set(world.fake.states.map((state) => state.device_feature_external_id));
    const missing = world.fake.discoveredDevices
      .flatMap((device) => device.features)
      .filter((feature) => feature.category !== 'camera' && !published.has(feature.external_id))
      // No alarm yet on these cameras: no last event to show.
      .filter((feature) => !feature.external_id.endsWith(':last_event'))
      .map((feature) => feature.external_id);
    assert.deepEqual(missing, []);
  } finally {
    await world.app.stop();
  }
});
