import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ENCRYPTED_HEADER,
  WrongCodeError,
  codeFingerprint,
  decryptPicture,
  encryptPicture,
  isEncrypted,
  passwordDigest,
} from '../src/ezviz/crypto.js';
import { JPEG } from './helpers/fakeCloud.js';

test('the login sends the MD5 digest of the password, as the EZVIZ apps', () => {
  assert.equal(passwordDigest('password'), '5f4dcc3b5aa765d61d8327deb882cf99');
  assert.equal(
    passwordDigest('mot de passe é'),
    createHash('md5').update('mot de passe é').digest('hex'),
  );
});

test('an encrypted picture: header, MD5(MD5(code)), AES-128-CBC', () => {
  const encrypted = encryptPicture(JPEG, 'ABCDEF');
  assert.ok(isEncrypted(encrypted));
  assert.ok(encrypted.subarray(0, 16).equals(ENCRYPTED_HEADER));
  assert.equal(encrypted.subarray(16, 48).toString(), codeFingerprint('ABCDEF'));
  assert.equal(
    codeFingerprint('ABCDEF'),
    createHash('md5').update(createHash('md5').update('ABCDEF').digest('hex')).digest('hex'),
  );
  assert.ok(decryptPicture(encrypted, 'ABCDEF').equals(JPEG));
});

test('a plain picture is returned as is; a wrong code is said as such', () => {
  assert.equal(isEncrypted(JPEG), false);
  assert.equal(decryptPicture(JPEG, 'ABCDEF'), JPEG);
  assert.throws(() => decryptPicture(encryptPicture(JPEG, 'ABCDEF'), 'QWERTY'), WrongCodeError);
});

test('stray bytes before, after and between blocks are tolerated', () => {
  const one = encryptPicture(JPEG.subarray(0, 1000), 'ABCDEF');
  const two = encryptPicture(JPEG.subarray(1000), 'ABCDEF');
  const bytes = Buffer.concat([Buffer.from('xx'), one, two, Buffer.from([1, 2, 3])]);
  assert.ok(decryptPicture(bytes, 'ABCDEF').equals(JPEG));
  assert.throws(() =>
    decryptPicture(Buffer.concat([ENCRYPTED_HEADER, Buffer.alloc(40)]), 'ABCDEF'),
  );
});
