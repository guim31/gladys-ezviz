#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real EZVIZ cloud, with the client of the integration
// (src/ezviz/client.js). Read-only: it logs in, reads, and never sends a
// command. Nothing sensitive is printed: no password, no e-mail, no session,
// no serial number in clear (masked), no picture address.
//
// Without an account (default): logs in with a made-up account and checks
// that EZVIZ refuses it cleanly (an EZVIZ error code, no crash):
//
//   node scripts/probe.mjs
//
// With an account (environment variables, never arguments, so they stay out
// of the shell history):
//
//   EZVIZ_USERNAME=… EZVIZ_PASSWORD=… [EZVIZ_SERVER=apiieu.ezvizlife.com] \
//   [EZVIZ_CODE=123456] node scripts/probe.mjs
//
// it lists the cameras (category, model, capabilities), the arming mode and
// the type codes and titles of the last alarms — what the integration needs
// to know to classify them — and downloads the last alarm picture to say
// whether it is encrypted. On a two-step account, the first run makes EZVIZ
// send a code: run it again with EZVIZ_CODE. The session is not saved.
// Exit code 0 when the probe behaved as expected, 1 otherwise.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { DEFAULT_SERVER, parseServer } from '../src/config.js';
import { ERROR_KINDS, EzvizClient } from '../src/ezviz/client.js';
import { isEncrypted } from '../src/ezviz/crypto.js';
import { parseAlarm, parseDeviceList } from '../src/ezviz/model.js';

const mask = (serial) => `${String(serial).slice(0, 2)}…${String(serial).slice(-2)}`;
const say = (line = '') => process.stdout.write(`${line}\n`);

async function refusal() {
  const client = new EzvizClient({
    server: DEFAULT_SERVER,
    featureCode: randomBytes(16).toString('hex'),
  });
  const username = `gladys-probe-${randomBytes(4).toString('hex')}@example.invalid`;
  say(`Login with a made-up account on ${DEFAULT_SERVER}…`);
  try {
    await client.login({ username, password: randomBytes(12).toString('hex') });
  } catch (err) {
    say(`Refused: kind "${err.kind}", EZVIZ code ${err.code ?? '-'} — ${err.message}`);
    if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.API) {
      say('OK: EZVIZ refuses an unknown account cleanly.');
      return 0;
    }
    say('UNEXPECTED: the cloud did not answer as expected (network, proxy?).');
    return 1;
  }
  say('UNEXPECTED: a made-up account was accepted.');
  return 1;
}

async function account() {
  const server = parseServer(process.env.EZVIZ_SERVER ?? '');
  if (!server) {
    say('EZVIZ_SERVER is not a host of the EZVIZ cloud.');
    return 1;
  }
  const client = new EzvizClient({ server, featureCode: randomBytes(16).toString('hex') });
  try {
    await client.login({
      username: process.env.EZVIZ_USERNAME,
      password: process.env.EZVIZ_PASSWORD,
      code: process.env.EZVIZ_CODE || undefined,
    });
  } catch (err) {
    say(`Login refused: kind "${err.kind}", EZVIZ code ${err.code ?? '-'}`);
    if (err.kind === ERROR_KINDS.MFA_REQUIRED) {
      say('EZVIZ sent a verification code: run again with EZVIZ_CODE=<code>.');
      return 0;
    }
    return 1;
  }
  say(`Logged in, API domain ${client.apiDomain}.`);

  const list = await client.deviceList();
  const infos = list.deviceInfos ?? [];
  const cameras = parseDeviceList(list);
  say(`${infos.length} device(s), ${cameras.length} camera(s) handled:`);
  for (const info of infos) {
    const camera = cameras.find((entry) => entry.serial === info.deviceSerial);
    const traits = camera
      ? [
          camera.online ? 'online' : 'offline/asleep',
          camera.ptz && 'ptz',
          camera.privacyCapable && 'privacy',
          camera.sleepCapable && 'sleep',
          camera.lightCapable && 'light',
          camera.sirenCapable && 'siren',
          camera.doorbell && 'doorbell',
          camera.battery !== null && `battery ${camera.battery}%`,
          camera.wifiSignal !== null && `wifi ${camera.wifiSignal}`,
          camera.sd &&
            `sd ${camera.sd.state}${camera.sd.capacityGb ? ` ${camera.sd.capacityGb} GB` : ''}`,
          camera.encrypted && 'encrypted pictures',
        ].filter(Boolean)
      : ['not handled'];
    say(
      `  ${mask(info.deviceSerial)} ${info.deviceCategory}/${info.deviceSubCategory}: ${traits.join(', ')}`,
    );
  }

  try {
    say(`Arming mode: ${await client.defenceMode()} (1 home, 2 away, 3 sleep)`);
  } catch (err) {
    say(`Arming mode not read: ${err.message}`);
  }

  const messages = await client.alarms({ limit: 20 });
  say(`${messages.length} recent alarm(s), newest first:`);
  const zones = new Map(cameras.map((camera) => [camera.serial, camera.timeZone]));
  const alarms = messages.map((message) => parseAlarm(message, (serial) => zones.get(serial)));
  for (const alarm of alarms.filter(Boolean).slice(0, 10)) {
    const age = alarm.at ? `${Math.round((Date.now() - alarm.at) / 60_000)} min ago` : 'no time';
    say(`  ${mask(alarm.serial)} code "${alarm.code}" "${alarm.title}" → ${alarm.kind} (${age})`);
  }
  const withPicture = alarms.find((alarm) => alarm?.picture);
  if (withPicture) {
    try {
      const bytes = await client.download(withPicture.picture);
      say(
        `Last alarm picture: ${bytes.length} bytes, ${isEncrypted(bytes) ? 'ENCRYPTED' : 'plain'}` +
          `${bytes[0] === 0xff && bytes[1] === 0xd8 ? ', JPEG' : ''}`,
      );
    } catch (err) {
      say(`Last alarm picture not downloaded: ${err.message}`);
    }
  }
  return 0;
}

const run = process.env.EZVIZ_USERNAME && process.env.EZVIZ_PASSWORD ? account : refusal;
run()
  .then((code) => process.exit(code))
  .catch((err) => {
    say(`Probe failed: ${err.kind ?? err.name}: ${err.message}`);
    process.exit(1);
  });
