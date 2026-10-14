// -----------------------------------------------------------------------------
// The two pieces of cryptography the EZVIZ cloud asks for, with node:crypto:
//
//   - the login sends the MD5 hex digest of the password, never the password
//     itself (as the EZVIZ apps and pyEzviz do);
//   - when "image encryption" is on, an alarm picture starts with the header
//     `hikencodepicture`, then the MD5(MD5(code)) hex of the camera
//     verification code (32 bytes), then the JPEG encrypted in AES-128-CBC:
//     key = the code padded with NUL bytes to 16, IV = "01234567" + 8 NULs,
//     PKCS#7 padding. A picture may hold several such blocks one after the
//     other. (Format from pyezvizapi.utils.decrypt_image, Apache-2.0.)
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

export const ENCRYPTED_HEADER = Buffer.from('hikencodepicture');
const HASH_LENGTH = 32;
const IV = Buffer.concat([Buffer.from('01234567'), Buffer.alloc(8)]);

const md5 = (value) => createHash('md5').update(value).digest('hex');

/** The password as the login endpoint takes it. */
export const passwordDigest = (password) => md5(Buffer.from(password, 'utf8'));

/** The fingerprint of a code written in an encrypted picture. */
export const codeFingerprint = (code) => md5(md5(Buffer.from(code, 'utf8')));

const aesKey = (code) => {
  const key = Buffer.alloc(16);
  Buffer.from(code, 'utf8').copy(key, 0, 0, 16);
  return key;
};

export const isEncrypted = (bytes) =>
  Buffer.isBuffer(bytes) && bytes.indexOf(ENCRYPTED_HEADER) !== -1;

export class WrongCodeError extends Error {
  constructor() {
    super('The picture is encrypted with another verification code');
    this.name = 'WrongCodeError';
  }
}

/**
 * The JPEG of an encrypted picture; a plain picture is returned as is.
 * @param {Buffer} bytes the downloaded picture
 * @param {string} code the verification code of the camera
 */
export function decryptPicture(bytes, code) {
  const start = bytes.indexOf(ENCRYPTED_HEADER);
  if (start === -1) {
    return bytes;
  }
  const minimum = ENCRYPTED_HEADER.length + HASH_LENGTH;
  const parts = [];
  let at = start;
  while (at !== -1 && at + minimum <= bytes.length) {
    const next = bytes.indexOf(ENCRYPTED_HEADER, at + ENCRYPTED_HEADER.length);
    const block = bytes.subarray(at, next === -1 ? bytes.length : next);
    const hash = block.subarray(ENCRYPTED_HEADER.length, minimum).toString('latin1');
    if (hash !== codeFingerprint(code)) {
      throw new WrongCodeError();
    }
    let cipher = block.subarray(minimum);
    // Some pictures carry a few stray bytes past the last AES block.
    cipher = cipher.subarray(0, cipher.length - (cipher.length % 16));
    if (cipher.length === 0) {
      throw new Error('The encrypted picture is empty');
    }
    const decipher = createDecipheriv('aes-128-cbc', aesKey(code), IV);
    parts.push(Buffer.concat([decipher.update(cipher), decipher.final()]));
    at = next;
  }
  if (parts.length === 0) {
    throw new Error('The encrypted picture is truncated');
  }
  return Buffer.concat(parts);
}

/** The reverse operation, for the tests and the fake cloud. */
export function encryptPicture(jpeg, code) {
  const cipher = createCipheriv('aes-128-cbc', aesKey(code), IV);
  return Buffer.concat([
    ENCRYPTED_HEADER,
    Buffer.from(codeFingerprint(code), 'latin1'),
    cipher.update(jpeg),
    cipher.final(),
  ]);
}
