import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  DEFAULT_SERVER,
  codeFor,
  normalizeConfig,
  parseCodes,
  parseServer,
} from '../src/config.js';

test('the defaults: European server, alarms every 30 s, captures every 15 min, French names', () => {
  const config = normalizeConfig({});
  assert.equal(config.server, DEFAULT_SERVER);
  assert.equal(config.serverInvalid, false);
  assert.equal(config.alarmIntervalMs, 30_000);
  assert.equal(config.snapshotIntervalMs, 15 * 60_000);
  assert.equal(config.allowArming, true);
  assert.equal(config.allowSiren, false, 'the siren stays off unless ticked');
  assert.equal(config.language, 'fr');
  assert.equal(config.username, '');
  assert.equal(config.password, '');
});

test('the values of the form are typed and checked', () => {
  const config = normalizeConfig({
    username: '  someone@example.com ',
    password: ' spaces kept ',
    alarm_interval: 15,
    snapshot_interval: '0',
    allow_arming: 'false',
    allow_siren: 'true',
    language: 'de',
  });
  assert.equal(config.username, 'someone@example.com');
  assert.equal(config.password, ' spaces kept ');
  assert.equal(config.alarmIntervalMs, 15_000);
  assert.equal(config.snapshotIntervalMs, 0);
  assert.equal(config.allowArming, false);
  assert.equal(config.allowSiren, true);
  assert.equal(config.language, 'de');
  const odd = normalizeConfig({ alarm_interval: '5', snapshot_interval: '7', language: 'it' });
  assert.equal(odd.alarmIntervalMs, Number(DEFAULT_CONFIG.alarm_interval) * 1000);
  assert.equal(odd.snapshotIntervalMs, Number(DEFAULT_CONFIG.snapshot_interval) * 60_000);
  assert.equal(odd.language, 'fr');
  assert.equal(normalizeConfig(null).server, DEFAULT_SERVER);
});

test('the API server: a host of the EZVIZ cloud, a region code, or the default', () => {
  assert.equal(parseServer(''), DEFAULT_SERVER);
  assert.equal(parseServer(undefined), DEFAULT_SERVER);
  assert.equal(parseServer('apiius.ezvizlife.com'), 'apiius.ezvizlife.com');
  assert.equal(parseServer('https://APIIEU.ezvizlife.com/v3/'), 'apiieu.ezvizlife.com');
  assert.equal(parseServer('us'), 'apiius.ezvizlife.com');
  assert.equal(parseServer('apirus.ezvizru.com'), 'apirus.ezvizru.com');
  // The password digest goes to the EZVIZ cloud only.
  assert.equal(parseServer('evil.example.com'), null);
  assert.equal(parseServer('ezvizlife.com.example.com'), null);
  assert.equal(parseServer('http://'), null);
  assert.equal(normalizeConfig({ api_server: 'evil.example.com' }).serverInvalid, true);
});

test('the verification codes: SERIAL:CODE pairs and one code for the others', () => {
  const codes = parseCodes('EZFAKE004:ABCDEF, ezfake006=QWERTY\nZXCVBN ??? ');
  assert.equal(codes.bySerial.get('EZFAKE004'), 'ABCDEF');
  assert.equal(codes.bySerial.get('EZFAKE006'), 'QWERTY');
  assert.equal(codes.fallback, 'ZXCVBN');
  assert.equal(codes.invalid, 1);
  const config = normalizeConfig({ verification_codes: 'EZFAKE004:ABCDEF ZXCVBN' });
  assert.equal(codeFor(config, 'EZFAKE004'), 'ABCDEF');
  assert.equal(codeFor(config, 'ezfake004'), 'ABCDEF');
  assert.equal(codeFor(config, 'EZFAKE999'), 'ZXCVBN');
  assert.equal(codeFor(normalizeConfig({}), 'EZFAKE004'), null);
  assert.equal(parseCodes(undefined).fallback, null);
});
