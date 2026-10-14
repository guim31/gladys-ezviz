// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container),
// in /data/ezviz-state.json, mode 0600:
//   - featureCode: the terminal id of this installation, drawn once. EZVIZ
//     binds a login to it: a new one at every start would ask for a new
//     verification code each time on a two-step account;
//   - session: the session of the account (sessionId, rfSessionId, API
//     domain), so a restart does not log in again. Keyed by a hash of the
//     account and server: another account in the configuration starts over;
//   - doorbells: the serials of the cameras seen ringing (a doorbell EZVIZ
//     does not class as one keeps its "ring" feature after a restart).
// The password stays in the Gladys configuration, never here.
// (Adapted from guim31/gladys-unifi-protect.)
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'ezviz-store' });
const FILE_NAME = 'ezviz-state.json';

/** A random terminal id, 32 hex characters like the EZVIZ apps send. */
export const newFeatureCode = () => randomBytes(16).toString('hex');

export class Store {
  constructor(directory = process.env.EZVIZ_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.data = {};
    this.pending = null;
    this.writing = null;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      this.data = data && typeof data === 'object' ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
      this.data = {};
    }
    if (
      typeof this.data.featureCode !== 'string' ||
      !/^[0-9a-f]{32}$/.test(this.data.featureCode)
    ) {
      this.data.featureCode = newFeatureCode();
      this.save();
    }
    return this.data;
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    if (value === undefined) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    return this.save();
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save() {
    if (!this.pending) {
      // Chained after the write in progress, if any: one writer at a time.
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        this.pending = null;
        const snapshot = JSON.stringify(this.data);
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, snapshot, { mode: 0o600 });
          await chmod(temporary, 0o600);
          await rename(temporary, this.path);
        } catch (err) {
          logger.warn(`Cannot write ${this.path}: ${err.message}`);
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
