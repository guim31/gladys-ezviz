import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import {
  BASE_CONFIG,
  SERIALS,
  cameraIds,
  createAll,
  createWorld,
  discovered,
  settle,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

const ofType = (c, type) => c.components.filter((component) => component.type === type);

test('the widget fits the vocabulary and the budget of the core, in every language', async (t) => {
  const w = await world(t);
  await createAll(w);
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const settings of [{}, { camera: cameraIds(w.gladys, SERIALS.PTZ).device }]) {
      assert.deepEqual(validateWidgetContent(await content(w, settings, language)), []);
    }
  }
});

test('the picture of the newest alarm, one row per camera, then the account mode', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.addAlarm(SERIALS.DRIVEWAY, { at: w.clock.now(), title: 'Person detected', type: '' });
  await w.hub.checkAlarms();
  const c = await content(w, {}, 'fr');
  const [image] = ofType(c, 'image');
  assert.match(image.key, /^alarm-[0-9a-f]+$/);
  const [status] = ofType(c, 'status');
  assert.equal(status.items[0].label, 'Driveway');
  assert.match(status.items[0].value, /^Personne · /);
  // Six cameras, then the mode of the account (not of a camera).
  assert.equal(status.items.length, 7);
  assert.deepEqual(
    { label: status.items.at(-1).label, value: status.items.at(-1).value },
    { label: 'Mode du compte EZVIZ', value: 'Absent' },
  );
  // The image is served, within the bounds of the core.
  const ack = await w.fake.widgetGetImage(image.key);
  assert.equal(ack.success, true);
  assert.deepEqual(validateWidgetImage(ack.data.image), []);
  const unknown = await w.fake.widgetGetImage('alarm-unknown');
  assert.equal(unknown.success, false);
});

test('several chosen cameras: their newest alarm, their rows only', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.addAlarm(SERIALS.DRIVEWAY, { at: w.clock.now(), title: 'Person detected', type: '' });
  await w.hub.checkAlarms();
  const cameras = [SERIALS.PTZ, SERIALS.GARAGE].map((serial) => cameraIds(w.gladys, serial).device);
  const c = await content(w, { cameras });
  const [status] = ofType(c, 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value.replace(/ · .*/, '')]),
    [
      // Its privacy mode is on: asleep, whatever its last event.
      ['Living room', 'Asleep'],
      ['Garage', 'Offline'],
      ['EZVIZ account mode', 'Away'],
    ],
  );
  // The picture is the one of the Living room alarm, not of the Driveway.
  const [image] = ofType(c, 'image');
  assert.equal(image.key, w.hub.alarms.last.get(SERIALS.PTZ).imageKey);
  assert.deepEqual(validateWidgetContent(c), []);
});

test('a chosen camera with the former setting still works', async (t) => {
  const w = await world(t);
  await createAll(w);
  const c = await content(w, { camera: cameraIds(w.gladys, SERIALS.DOORBELL).device });
  const [status] = ofType(c, 'status');
  assert.equal(status.items[0].label, 'Front door');
  assert.match(status.items[0].value, /^Doorbell · /);
  assert.equal(status.items.length, 2);
  const none = await content(w, { cameras: [cameraIds(w.gladys, SERIALS.GARAGE).device] });
  assert.match(ofType(none, 'text')[0].text, /No alarm/);
  assert.equal(ofType(none, 'status')[0].items[0].value, 'Offline');
  const gone = await content(w, { camera: 'ext:test-integration:camera:GONE' });
  assert.match(gone.components[0].text, /no longer in the EZVIZ account/);
});

test('the arming buttons: the current one marked by its icon, "at home" confirmed', async (t) => {
  const w = await world(t);
  const buttons = ofType(await content(w), 'button');
  assert.deepEqual(
    buttons.map((b) => [b.action.key, b.icon, b.action.confirm ?? false]),
    [
      ['arm_home', 'home', true],
      ['arm_away', 'check-circle', false],
      ['arm_sleep', 'moon', false],
    ],
  );
  assert.ok(
    buttons.every((b) => b.style === 'secondary'),
    'primary does not show in dark mode',
  );
  const ack = await w.fake.widgetAction(WIDGET_KEY, 'arm_sleep', { mode: 'sleep' }, {});
  assert.equal(ack.success, true, ack.error);
  // The toast says the mode is the account's, for every camera.
  assert.equal(ack.data.message.fr, 'Mode du compte EZVIZ (toutes les caméras) : Sommeil');
  assert.equal(w.cloud.mode, 3);
  const after = ofType(await content(w), 'button');
  assert.equal(after.find((b) => b.action.key === 'arm_sleep').icon, 'check-circle');
});

test('no arming button when arming is not allowed; a message when not configured', async (t) => {
  const locked = await world(t, { config: { ...BASE_CONFIG, allow_arming: false } });
  assert.deepEqual(ofType(await content(locked), 'button'), []);
  const ack = await locked.fake.widgetAction(WIDGET_KEY, 'arm_home', { mode: 'home' }, {});
  assert.equal(ack.success, false);

  const empty = await world(t, { config: {} });
  const c = await content(empty, {}, 'de');
  assert.match(c.components[0].text, /E-Mail und das Passwort/);
});

test('the cloud unreachable: said in a caption, no button', async (t) => {
  const w = await world(t);
  w.cloud.online = false;
  await w.hub.refresh();
  const c = await content(w);
  assert.match(ofType(c, 'text')[0].text, /does not answer/);
  assert.deepEqual(ofType(c, 'button'), []);
  assert.deepEqual(validateWidgetContent(c), []);
});

test('"EZVIZ account" chosen in the camera list is ignored: alone, it means all cameras', async (t) => {
  const w = await world(t);
  await createAll(w);
  const account = discovered(w, 'account').external_id;
  const alone = await content(w, { cameras: [account] });
  // Six cameras and the account mode, as with no choice at all.
  assert.equal(ofType(alone, 'status')[0].items.length, 7);
  const ptz = cameraIds(w.gladys, SERIALS.PTZ).device;
  const withOne = await content(w, { cameras: [account, ptz] });
  assert.deepEqual(
    ofType(withOne, 'status')[0].items.map((item) => item.label),
    ['Living room', 'EZVIZ account mode'],
  );
});

test('the cameras are named as in Gladys once added, as in EZVIZ before', async (t) => {
  const w = await world(t);
  const ptz = discovered(w, SERIALS.PTZ);
  const before = await content(w, { cameras: [ptz.external_id] });
  assert.equal(ofType(before, 'status')[0].items[0].label, 'Living room');
  await w.fake.deviceCreated({ ...ptz, name: 'Babyphone Léa' });
  await settle();
  const after = await content(w, { cameras: [ptz.external_id] });
  assert.equal(ofType(after, 'status')[0].items[0].label, 'Babyphone Léa');
  // Renamed again later: the widget follows (and is asked to refresh).
  const refreshes = w.fake.widgetRefreshes.length;
  await w.fake.deviceUpdated({ ...ptz, name: 'Babyphone Victor' });
  await settle();
  assert.equal(
    ofType(await content(w, { cameras: [ptz.external_id] }), 'status')[0].items[0].label,
    'Babyphone Victor',
  );
  assert.ok(w.fake.widgetRefreshes.length > refreshes);
});

test('one camera shown that can sleep: a button to put it to sleep or wake it', async (t) => {
  const w = await world(t);
  await createAll(w);
  const floodlight = cameraIds(w.gladys, SERIALS.FLOODLIGHT).device;
  const c = await content(w, { cameras: [floodlight] });
  const buttons = ofType(c, 'button');
  assert.equal(buttons.length, 4, 'the sleep button and the three arming buttons');
  const [sleep] = buttons;
  assert.deepEqual(sleep.action, {
    key: 'camera_sleep',
    params: { camera: floodlight, sleep: true },
  });
  assert.equal(sleep.label, 'Sleep');
  assert.deepEqual(validateWidgetContent(c), []);

  const ack = await w.fake.widgetAction(WIDGET_KEY, 'camera_sleep', sleep.action.params, {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'Garden floodlight: en veille');
  assert.equal(w.cloud.devices.SWITCH[SERIALS.FLOODLIGHT].find((s) => s.type === 21).enable, true);
  const after = await content(w, { cameras: [floodlight] }, 'fr');
  const [wake] = ofType(after, 'button');
  assert.equal(wake.label, 'Réveiller');
  assert.deepEqual(wake.action.params, { camera: floodlight, sleep: false });
  assert.deepEqual(ofType(after, 'status')[0].items[0], {
    label: 'Garden floodlight',
    icon: 'eye-off',
    value: 'En veille',
    color: 'neutral',
  });

  // Several cameras: no room for one button each (the scene action covers them).
  const several = await content(w, {});
  assert.equal(ofType(several, 'button').length, 3);
  // A camera with neither mode: no sleep button.
  const battery = await content(w, { cameras: [cameraIds(w.gladys, SERIALS.BATTERY).device] });
  assert.ok(ofType(battery, 'button').every((b) => b.action.key.startsWith('arm_')));
});
