import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { BASE_CONFIG, SERIALS, cameraIds, createAll, createWorld } from './helpers/world.js';

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

test('the picture of the newest alarm, its event and the arming mode', async (t) => {
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
  assert.deepEqual(
    { label: status.items[1].label, value: status.items[1].value },
    { label: 'Mode d’armement', value: 'Absent' },
  );
  // The image is served, within the bounds of the core.
  const ack = await w.fake.widgetGetImage(image.key);
  assert.equal(ack.success, true);
  assert.deepEqual(validateWidgetImage(ack.data.image), []);
  const unknown = await w.fake.widgetGetImage('alarm-unknown');
  assert.equal(unknown.success, false);
});

test('a chosen camera: its own last alarm and its online state', async (t) => {
  const w = await world(t);
  await createAll(w);
  const c = await content(w, { camera: cameraIds(w.gladys, SERIALS.DOORBELL).device });
  const [status] = ofType(c, 'status');
  assert.equal(status.items[0].label, 'Front door');
  assert.match(status.items[0].value, /^Doorbell · /);
  assert.deepEqual(status.items.at(-1).value, 'Online');
  const none = await content(w, { camera: cameraIds(w.gladys, SERIALS.GARAGE).device });
  assert.match(ofType(none, 'text')[0].text, /No alarm/);
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
  assert.equal(ack.data.message.fr, 'Mode d’armement : Sommeil');
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
