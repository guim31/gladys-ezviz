import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALARM_KINDS,
  alarmInstant,
  classifyAlarm,
  isCamera,
  parseAlarm,
  parseCamera,
  parseDeviceList,
  parseOffset,
  restSwitch,
} from '../src/ezviz/model.js';
import { SERIALS } from './helpers/fakeCloud.js';

const list = JSON.parse(
  readFileSync(new URL('./fixtures/ezviz/pagelist.json', import.meta.url), 'utf8'),
);
const alarms = JSON.parse(
  readFileSync(new URL('./fixtures/ezviz/alarms.json', import.meta.url), 'utf8'),
).message;
const bySerial = new Map(parseDeviceList(list).map((camera) => [camera.serial, camera]));

test('every camera of the real device list is read, with its capabilities', () => {
  assert.deepEqual(
    [...bySerial.keys()],
    [
      SERIALS.FLOODLIGHT,
      SERIALS.PTZ,
      SERIALS.BATTERY,
      SERIALS.DRIVEWAY,
      SERIALS.GARAGE,
      SERIALS.DOORBELL,
    ],
  );
  const floodlight = bySerial.get(SERIALS.FLOODLIGHT);
  assert.equal(floodlight.lightCapable, true);
  assert.equal(floodlight.sirenCapable, true);
  assert.equal(floodlight.ptz, false);
  assert.deepEqual(floodlight.sd, { state: 'absent', capacityGb: null });
  const ptz = bySerial.get(SERIALS.PTZ);
  assert.equal(ptz.ptz, true);
  assert.equal(ptz.privacyCapable, true);
  assert.equal(ptz.sirenCapable, false);
  assert.equal(ptz.sd.state, 'normal');
  assert.equal(ptz.sd.capacityGb, 58);
  assert.equal(ptz.detection, true);
  assert.equal(ptz.encrypted, true);
  const battery = bySerial.get(SERIALS.BATTERY);
  assert.equal(battery.online, false, 'status 2: asleep or offline');
  assert.equal(battery.battery, 100);
  assert.equal(battery.batteryPowered, true);
  assert.equal(battery.wifiSignal, 88);
  assert.equal(bySerial.get(SERIALS.DOORBELL).doorbell, true);
  assert.equal(bySerial.get(SERIALS.PTZ).localIp, '192.0.2.23');
  assert.equal(bySerial.get(SERIALS.PTZ).rtspPort, 554, '0 in the list: the default port');
  assert.equal(bySerial.get(SERIALS.PTZ).timeZone, 'UTC+02:00');
});

test('only the cameras: no light bulb, no plug, no base station; a Hikvision camera is', () => {
  assert.equal(isCamera({ deviceSerial: 'A1', deviceCategory: 'lighting' }), false);
  assert.equal(isCamera({ deviceSerial: 'A1', deviceCategory: 'Socket' }), false);
  assert.equal(isCamera({ deviceSerial: 'A1', deviceCategory: 'XVR' }), false);
  assert.equal(isCamera({ deviceSerial: 'A1', deviceCategory: 'COMMON' }), false);
  assert.equal(isCamera({ deviceSerial: 'A1', deviceCategory: 'COMMON', hik: true }), true);
  assert.equal(isCamera({ deviceCategory: 'IPC' }), false);
  assert.equal(parseDeviceList(null).length, 0);
});

test('a camera with few sections still reads', () => {
  const camera = parseCamera({ deviceSerial: 'BARE01', deviceCategory: 'IPC', status: 1 });
  assert.equal(camera.name, null);
  assert.equal(camera.detection, null);
  assert.equal(camera.battery, null);
  assert.equal(camera.wifiSignal, null);
  assert.equal(camera.sd, null);
  assert.equal(camera.privacyCapable, false);
  assert.equal(camera.sirenCapable, false);
  // supportExt may come decoded, and the SD card unknown.
  const decoded = parseCamera(
    { deviceSerial: 'SD01', deviceCategory: 'IPC', supportExt: { 4: '1' } },
    { STATUS: { SD01: { diskNum: 1, diskState: '2-', optionals: { diskCapacity: '30000,-1' } } } },
  );
  assert.deepEqual(decoded.sd, { state: 'unformatted', capacityGb: 29.3 });
});

test('the kind of an alarm: its code when known, else its English title', () => {
  assert.equal(classifyAlarm('10002', 'whatever'), ALARM_KINDS.MOTION);
  assert.equal(classifyAlarm('10000', ''), ALARM_KINDS.MOTION);
  assert.equal(classifyAlarm('10016', ''), ALARM_KINDS.DOORBELL);
  assert.equal(classifyAlarm('10029', 'Human shape detected'), ALARM_KINDS.PERSON);
  assert.equal(classifyAlarm('', 'Person detected'), ALARM_KINDS.PERSON);
  assert.equal(classifyAlarm('', 'Someone is calling'), ALARM_KINDS.DOORBELL);
  assert.equal(classifyAlarm('', 'Doorbell rang'), ALARM_KINDS.DOORBELL);
  assert.equal(classifyAlarm('', 'PIR alarm'), ALARM_KINDS.MOTION);
  assert.equal(classifyAlarm('', 'Sound detected'), ALARM_KINDS.OTHER);
  // A word that only contains "ring" is not a doorbell.
  assert.equal(classifyAlarm('', 'Monitoring tampering'), ALARM_KINDS.OTHER);
});

test('the instant of an alarm: epoch, or the camera clock when they disagree', () => {
  assert.equal(parseOffset('UTC+02:00'), 120);
  assert.equal(parseOffset('GMT-5'), -300);
  assert.equal(parseOffset('+0530'), 330);
  assert.equal(parseOffset('Europe/Paris'), null);
  const at = Date.UTC(2026, 9, 14, 10, 58);
  assert.equal(alarmInstant({ time: String(at), timeStr: '2026-10-14 12:58:00' }, 'UTC+02:00'), at);
  // An epoch written in the camera clock: the text read in its time zone wins.
  assert.equal(
    alarmInstant(
      { time: Date.UTC(2026, 9, 14, 12, 58), timeStr: '2026-10-14 12:58:00' },
      'UTC+02:00',
    ),
    at,
  );
  assert.equal(alarmInstant({ time: at / 1000 }, null), at, 'seconds');
  assert.equal(alarmInstant({ timeStr: '2026-10-14 12:58:00' }, 'UTC+02:00'), at);
  assert.equal(alarmInstant({}, null), null);
});

test('an alarm of the list, as a record', () => {
  const [motion, ring] = alarms.map((message) => parseAlarm(message, () => 'UTC+02:00'));
  assert.deepEqual(motion, {
    id: '2026101412580001EZFAKE004',
    serial: SERIALS.PTZ,
    at: Date.UTC(2026, 9, 14, 10, 58),
    title: 'Motion Detection Alarm',
    code: '10002',
    kind: ALARM_KINDS.MOTION,
    picture: 'https://pictures.ezviz.test/alarms/EZFAKE004-1.jpg',
  });
  assert.equal(ring.kind, ALARM_KINDS.DOORBELL);
  assert.equal(parseAlarm({ deviceSerial: 'X' }), null, 'no id');
  assert.equal(parseAlarm(null), null);
  const plain = parseAlarm({ msgId: 1, deviceSerial: 'X', pic: 'http://insecure/1.jpg' });
  assert.equal(plain.picture, null, 'https only');
  assert.equal(plain.kind, ALARM_KINDS.OTHER);
});

test('sleep mode: switch 21 and the SupportSleep capability, as Home Assistant reads them', () => {
  // A C6N as pyEzvizApi reads it (no real C6N answer is published): SupportSleep
  // (62) announced, switch 21 on.
  const c6n = parseCamera(
    {
      deviceSerial: 'C6NFAKE',
      deviceCategory: 'IPC',
      deviceSubCategory: 'C6N',
      status: 1,
      supportExt: JSON.stringify({ 62: '1', 154: '1' }),
    },
    {
      SWITCH: {
        C6NFAKE: [
          { type: 21, enable: 1 },
          { type: 7, enable: 0 },
        ],
      },
    },
  );
  assert.equal(c6n.sleepCapable, true);
  assert.equal(c6n.sleep, true);
  // Switch 7 is listed but SupportPtzPrivacy (40) is not: no privacy mode.
  assert.equal(c6n.privacyCapable, false);
  assert.deepEqual(restSwitch(c6n), { field: 'sleep', type: 21 });

  // The real list: every camera lists switch 21, only some announce 62.
  const bySerial = new Map(parseDeviceList(list).map((camera) => [camera.serial, camera]));
  assert.equal(bySerial.get(SERIALS.FLOODLIGHT).sleepCapable, true);
  assert.equal(bySerial.get(SERIALS.FLOODLIGHT).sleep, false);
  assert.equal(bySerial.get(SERIALS.PTZ).sleepCapable, false, 'the C6CN does not announce 62');
  assert.deepEqual(restSwitch(bySerial.get(SERIALS.PTZ)), { field: 'privacy', type: 7 });
  assert.equal(bySerial.get(SERIALS.BATTERY).sleepCapable, false);
  assert.equal(restSwitch(bySerial.get(SERIALS.BATTERY)), null);
});
