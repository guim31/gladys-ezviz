// -----------------------------------------------------------------------------
// The EZVIZ hub: one cloud account, read on the container's own timers.
//
//   - the alarm list (one request for every camera) every 15 to 120 s, as
//     chosen in the configuration (30 s by default, the pace of Home
//     Assistant): a new alarm pulses the motion or ring feature, updates the
//     "last event", downloads its picture (decrypted with the verification
//     code when the camera encrypts it) and publishes it as the camera image,
//     then fires the scene trigger — the image first, so a scene sending
//     "the camera image" sends the right one;
//   - the device list and the arming mode every 5 minutes, and after a
//     command: online, switches, battery, Wi-Fi, SD card;
//   - a fresh capture of the mains-powered cameras on the timer of the
//     configuration, never of a battery camera (each capture wakes it up).
// The container refreshes itself: Gladys never polls (should_poll: false,
// GladysAssistant/Gladys#3198); onPoll only asks for an early read.
//
// Session: the one saved in /data is reused; when EZVIZ refuses it, it is
// renewed, then the account logs in again with the password of the
// configuration. A refused password, a locked account or a verification code
// to type stop the automatic logins until the configuration changes or the
// user acts (Test the connection, Enter the verification code): retrying a
// wrong password is how an EZVIZ account gets locked.
//
// States go through publishChangedStates (only the changes, plus a heartbeat
// every 6 hours: the front shows "no recent value" past 48 hours), and only
// for the devices the user added: Gladys drops the others.
//
// Logs: info keeps the lifecycle (connected, cloud lost and back, a camera
// offline and back, a login, user commands); a problem that repeats is
// logged once, and once when it clears; the rest goes to debug
// (LOG_LEVEL=debug). Never the password, a session, a verification code, a
// picture or stream address, nor the e-mail of the account.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { codeFor, isCode } from './config.js';
import {
  FEATURE_KEYS,
  MOVES,
  accountIds,
  buildAccount,
  buildCamera,
  cameraIds,
  cameraName,
  featureKeys,
  featureValues,
} from './devices.js';
import { WrongCodeError, decryptPicture, isEncrypted } from './ezviz/crypto.js';
import { ERROR_KINDS, EzvizClient, EzvizError } from './ezviz/client.js';
import { ALARM_KINDS, ARM_MODES, SWITCHES, parseAlarm, parseDeviceList } from './ezviz/model.js';
import { toCameraImage } from './image.js';
import {
  ACTION_TEXT,
  ALARM_NAMES,
  CODE_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  eventText,
  localized,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'ezviz-hub' });

export const WIDGET_KEY = 'ezviz';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  DETECTION: 'camera_detection',
  DOORBELL: 'doorbell_pressed',
});

export const HUB_TIMINGS = {
  // Device list and arming mode.
  refreshMs: 5 * 60_000,
  heartbeatMs: 6 * 60 * 60_000,
  // Motion stays 1 this long after an alarm (Home Assistant: one minute).
  motionMs: 60_000,
  // A ring: 1, then 0 after this.
  ringMs: 10_000,
  // The firmware stops a siren by itself after a minute.
  sirenMs: 60_000,
  // A command wins over a device list read this soon after it (the cloud
  // takes a moment to report the new state).
  holdMs: 60_000,
  // The core takes 12 images a minute per camera at most.
  imageSpacingMs: 6_000,
  // "Send the camera image" right after an alarm sends the alarm picture,
  // not a capture taken seconds later (the scene runs within this delay).
  liveReuseMs: 30_000,
  // A scene event waits this long at most for the picture of its alarm.
  eventImageWaitMs: 8_000,
  // An alarm the cloud lists later than this is shown, but fires nothing.
  lateAlarmMs: 10 * 60_000,
};

const MAX_SEEN = 2000;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);

/** The account a saved session belongs to: never the e-mail itself. */
const accountOf = (config) => hash(`${config.username.toLowerCase()}|${config.server}`);

const signature = (config) => JSON.stringify([config.username, config.password, config.server]);

export class EzvizHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/ezviz/http.js)
   * @param {Function} [options.toImage] JPEG → camera image (src/image.js)
   * @param {boolean} [options.timers] periodic timers (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, toImage, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.toImage = toImage ?? toCameraImage;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.signature = null;
    this.client = null;
    /** Why automatic logins stopped (an EzvizError), null when they may run. */
    this.blocked = null;
    this.read = { ok: null, error: null, downSince: null };
    this.cameras = new Map();
    this.armMode = null;
    this.doorbells = new Set();
    this.alarms = { baseline: false, seen: new Set(), last: new Map() };
    this.pulses = new Map();
    this.sirens = new Map();
    this.held = new Map();
    this.images = new Map();
    this.imageReads = new Map();
    this.thumbnails = new Map();
    this.keys = new Map();
    this.online = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovery = null;
    this.reading = null;
    this.checking = null;
    this.timers = {};
    this.stopped = false;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Logs ------------------------------------------------------------------

  /** Log a problem once (`level` warn or info), its repeats at debug. */
  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  /** The problem `key` is gone: say so once, the next occurrence logs again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.doorbells = new Set(Array.isArray(saved.doorbells) ? saved.doorbells : []);
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovery = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const next = signature(config);
    const changed = next !== this.signature;
    const previous = this.config;
    this.config = config;
    if (changed) {
      this.signature = next;
      this.blocked = null;
      this.read = { ok: null, error: null, downSince: null };
      this.cameras = new Map();
      this.armMode = null;
      this.alarms = { baseline: false, seen: new Set(), last: new Map() };
      this.online.clear();
      this.keys.clear();
      this.client = this.createClient(config);
    } else if (previous && JSON.stringify(previous.codes) !== JSON.stringify(config.codes)) {
      this.keys.clear();
    }
    this.discovery = null;
    if (!this.client) {
      this.clearTimers();
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    await this.refresh();
    this.schedule();
  }

  createClient(config) {
    if (!config.username || !config.password || !config.server) {
      return null;
    }
    const saved = this.store.get('session');
    const account = accountOf(config);
    return new EzvizClient({
      server: config.server,
      featureCode: this.store.get('featureCode'),
      session: saved?.account === account ? saved : null,
      onSession: (session) => {
        this.store.set('session', { ...session, account });
      },
      request: this.request,
    });
  }

  async stop() {
    this.stopped = true;
    this.clearTimers();
    for (const timers of [...this.pulses.values(), this.sirens]) {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    }
    this.pulses.clear();
    this.sirens.clear();
    await this.store.flush();
  }

  clearTimers() {
    for (const timer of Object.values(this.timers)) {
      clearTimeout(timer);
    }
    this.timers = {};
  }

  /** (Re)arm the three timers of the hub. */
  schedule() {
    this.clearTimers();
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    const loop = (name, interval, run) => {
      if (interval <= 0) {
        return;
      }
      this.timers[name] = setTimeout(async () => {
        await run().catch((err) => logger.debug(`Timer ${name}: ${err.message}`));
        if (!this.stopped && this.timers[name]) {
          loop(name, interval, run);
        }
      }, interval);
    };
    loop('devices', this.timings.refreshMs, () => this.refresh());
    loop('alarms', this.config.alarmIntervalMs, () => this.checkAlarms());
    loop('snapshots', this.config.snapshotIntervalMs, () => this.snapshotAll());
  }

  // --- Session -----------------------------------------------------------------

  /** A session, logging in with the password when none is valid. */
  async ensureSession() {
    if (this.client.loggedIn) {
      return;
    }
    if (this.blocked) {
      throw this.blocked;
    }
    try {
      await this.client.login({ username: this.config.username, password: this.config.password });
    } catch (err) {
      this.loginFailed(err);
      throw err;
    }
    this.loggedIn();
  }

  loggedIn() {
    this.blocked = null;
    this.resolved('login');
    logger.info('Logged in to the EZVIZ account');
  }

  loginFailed(err) {
    if (err.kind === ERROR_KINDS.UNREACHABLE) {
      return; // a network problem: the next read tries again
    }
    // Refused password, locked account, code to type: no automatic retry.
    this.blocked = err;
    const level = err.kind === ERROR_KINDS.MFA_REQUIRED ? 'info' : 'warn';
    this.problem(
      'login',
      err.kind === ERROR_KINDS.MFA_REQUIRED
        ? 'EZVIZ sent a verification code: enter it with the "Enter the verification code" action'
        : `EZVIZ login refused: ${err.message}`,
      level,
    );
  }

  /** Run a cloud call with a session; a session refused logs in once more. */
  async withSession(run) {
    await this.ensureSession();
    try {
      return await run(this.client);
    } catch (err) {
      if (err.kind !== ERROR_KINDS.SESSION) {
        throw err;
      }
      logger.debug('EZVIZ session expired: logging in again');
      this.client.session = null;
      await this.ensureSession();
      return run(this.client);
    }
  }

  // --- Reading the cloud ---------------------------------------------------------

  /** Read the devices and the arming mode. Concurrent calls share the read. */
  refresh() {
    this.reading ??= this.readDevices().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async readDevices() {
    const client = this.client;
    if (!client) {
      return false;
    }
    let list;
    let mode;
    try {
      [list, mode] = await this.withSession(async (current) => [
        await current.deviceList(),
        await current.defenceMode().catch((err) => {
          logger.debug(`Arming mode not read: ${err.message}`);
          return null;
        }),
      ]);
    } catch (err) {
      if (client === this.client) {
        await this.readFailed(err);
      }
      return false;
    }
    if (client !== this.client) {
      return false; // reconfigured while reading
    }
    this.applyDevices(parseDeviceList(list));
    if (mode !== null) {
      this.armMode = mode;
    }
    this.readSucceeded();
    await this.publishDevices();
    await this.publishAllStates();
    if (!this.alarms.baseline) {
      await this.checkAlarms();
    }
    await this.afterChanges();
    return true;
  }

  /** The new device list; a command sent moments ago wins over it. */
  applyDevices(cameras) {
    const now = this.now();
    for (const [key, hold] of this.held) {
      if (hold.until < now) {
        this.held.delete(key);
      }
    }
    this.cameras = new Map(
      cameras.map((camera) => {
        for (const field of ['detection', 'privacy', 'light']) {
          const hold = this.held.get(`${camera.serial}:${field}`);
          if (hold) {
            camera[field] = hold.value;
          }
        }
        return [camera.serial, camera];
      }),
    );
  }

  readSucceeded() {
    const wasDown = this.read.ok === false;
    const first = this.read.ok === null;
    this.read.ok = true;
    this.read.error = null;
    if (first) {
      logger.info(
        `Connected to the EZVIZ cloud (${this.client.apiDomain}): ${this.cameras.size} camera(s)`,
      );
    } else if (wasDown) {
      const minutes = Math.max(1, Math.round((this.now() - this.read.downSince) / 60_000));
      logger.info(`The EZVIZ cloud answers again after ${minutes} min`);
    }
    this.warned.delete('read');
    this.read.downSince = null;
    if (this.ambiguousCodes()) {
      this.problem(
        'codes',
        `${this.config.codes.bare} verification codes without a serial number in the configuration: none is used`,
      );
    } else {
      this.resolved('codes');
    }
  }

  async readFailed(err) {
    if (this.blocked) {
      // Not a cloud outage: the account waits for the user (status, widget).
      await this.afterChanges();
      return;
    }
    if (this.read.ok !== false) {
      this.read.downSince = this.now();
    }
    this.read.ok = false;
    this.read.error = err;
    this.problem(
      'read',
      `Cannot read the EZVIZ cloud: ${err.message}`,
      err.kind === ERROR_KINDS.UNREACHABLE ? 'info' : 'warn',
    );
    await this.afterChanges();
  }

  // --- Alarms ------------------------------------------------------------------

  /** Read the alarm list. Concurrent calls share the read. */
  checkAlarms() {
    this.checking ??= this.readAlarms().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  async readAlarms() {
    if (!this.client || this.cameras.size === 0) {
      return false;
    }
    let messages;
    try {
      messages = await this.withSession((client) => client.alarms());
      this.resolved('alarms', 'Alarms of the EZVIZ cloud: read again');
    } catch (err) {
      if (!this.blocked) {
        this.problem('alarms', `Cannot read the EZVIZ alarms: ${err.message}`, 'info');
      }
      return false;
    }
    const alarms = messages
      .map((message) => parseAlarm(message, (serial) => this.cameras.get(serial)?.timeZone))
      .filter((alarm) => alarm && this.cameras.has(alarm.serial))
      .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    const baseline = !this.alarms.baseline;
    const fresh = [];
    for (const alarm of alarms) {
      if (this.alarms.seen.has(alarm.id)) {
        continue;
      }
      this.remember(alarm);
      const late = alarm.at !== null && this.now() - alarm.at > this.timings.lateAlarmMs;
      if (!baseline && !late) {
        fresh.push(alarm);
      }
    }
    this.alarms.baseline = true;
    if (baseline) {
      // The alarms before the start fire nothing; their last picture still
      // gives each camera an image.
      for (const serial of this.alarms.last.keys()) {
        await this.publishStates(this.cameras.get(serial));
        if (this.isCreated(cameraIds(this.gladys, serial).device)) {
          await this.alarmImage(serial);
        }
      }
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return true;
    }
    for (const alarm of fresh) {
      await this.alarmed(alarm);
    }
    if (fresh.length > 0) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
    return true;
  }

  /** Keep an alarm as the last one of its camera, when it is the newest. */
  remember(alarm) {
    this.alarms.seen.add(alarm.id);
    if (this.alarms.seen.size > MAX_SEEN) {
      this.alarms.seen = new Set([...this.alarms.seen].slice(-MAX_SEEN / 2));
    }
    const last = this.alarms.last.get(alarm.serial);
    if (!last || (alarm.at ?? 0) >= (last.at ?? 0)) {
      this.alarms.last.set(alarm.serial, { ...alarm, imageKey: null });
    }
  }

  /** A new alarm: pulse, last event, picture, then the scene event. */
  async alarmed(alarm) {
    const camera = this.cameras.get(alarm.serial);
    logger.debug(
      `Alarm on ${cameraName(camera)}: ${alarm.kind} (code ${alarm.code || '-'}, "${alarm.title}")`,
    );
    const ids = cameraIds(this.gladys, camera.serial);
    if (alarm.kind === ALARM_KINDS.DOORBELL) {
      if (!camera.doorbell && !this.doorbells.has(camera.serial)) {
        // A doorbell EZVIZ does not class as one: it now has a ring feature.
        this.doorbells.add(camera.serial);
        this.store.set('doorbells', [...this.doorbells]);
        logger.info(`${cameraName(camera)} rang: it is now known as a doorbell`);
        await this.publishDevices();
      }
      await this.pulse(camera, FEATURE_KEYS.RING, this.timings.ringMs);
    } else {
      await this.pulse(camera, FEATURE_KEYS.MOTION, this.timings.motionMs);
    }
    // The picture first, waited a few seconds at most (only the newest alarm
    // of the camera: an older one of the same batch would be replaced at once).
    if (this.alarms.last.get(camera.serial)?.id === alarm.id) {
      await Promise.race([
        this.alarmImage(camera.serial, alarm),
        delay(this.timings.eventImageWaitMs),
      ]);
    }
    const names = ALARM_NAMES[this.language] ?? ALARM_NAMES.en;
    if (alarm.kind === ALARM_KINDS.DOORBELL) {
      await this.fire(TRIGGERS.DOORBELL, {
        doorbell: ids.device,
        doorbell_name: this.nameOf(camera),
      });
    } else {
      await this.fire(TRIGGERS.DETECTION, {
        camera: ids.device,
        kind: alarm.kind,
        camera_name: this.nameOf(camera),
        kind_name: names[alarm.kind],
        alarm_name: alarm.title || names[alarm.kind],
        alarm_code: alarm.code,
      });
    }
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  /** A momentary feature: 1 now, 0 after `ms`. */
  async pulse(camera, key, ms) {
    const timers = this.pulses.get(camera.serial) ?? new Map();
    this.pulses.set(camera.serial, timers);
    clearTimeout(timers.get(key));
    const timer = setTimeout(() => {
      timers.delete(key);
      const current = this.cameras.get(camera.serial);
      if (current && !this.stopped) {
        this.publishStates(current).catch(() => {});
      }
    }, ms);
    timer.unref?.();
    timers.set(key, timer);
    await this.publishStates(camera);
  }

  // --- Pictures ------------------------------------------------------------------

  /**
   * The picture of an alarm (the last one of the camera by default), sent to
   * Gladys as the camera image and kept for the widget.
   * @returns {Promise<string|null>}
   */
  async alarmImage(serial, alarm = this.alarms.last.get(serial)) {
    const camera = this.cameras.get(serial);
    if (!camera || !alarm?.picture) {
      return null;
    }
    const image = await this.picture(camera, () => Promise.resolve(alarm.picture), 'alarm');
    if (image) {
      const last = this.alarms.last.get(serial);
      const key = `alarm-${hash(alarm.id)}`;
      this.thumbnails.set(key, image.slice(image.indexOf(',') + 1));
      if (last?.id === alarm.id) {
        if (last.imageKey && last.imageKey !== key) {
          this.thumbnails.delete(last.imageKey);
        }
        last.imageKey = key;
      }
    }
    return image;
  }

  /**
   * A fresh capture of a camera. Concurrent calls share the read; a read
   * younger than `imageSpacingMs` is reused (the core takes 12 images a minute
   * per camera).
   */
  cameraImage(camera, { fresh = false, reuseMs = this.timings.imageSpacingMs } = {}) {
    const last = this.images.get(camera.serial);
    if (!fresh && last && this.now() - last.at < reuseMs) {
      return Promise.resolve(last.image);
    }
    const running = this.imageReads.get(camera.serial);
    if (running) {
      return running;
    }
    const read = this.picture(
      camera,
      () => this.withSession((client) => client.capture(camera.serial)),
      'capture',
    ).finally(() => this.imageReads.delete(camera.serial));
    this.imageReads.set(camera.serial, read);
    return read;
  }

  /** Download, decrypt, fit and publish a picture; null when it failed. */
  async picture(camera, address, what) {
    let image;
    try {
      const url = await address();
      const bytes = await this.withSession((client) => client.download(url));
      image = await this.toImage(await this.decrypt(camera, bytes));
      this.resolved(`image-${camera.serial}`, `Pictures of ${cameraName(camera)}: back`);
    } catch (err) {
      this.problem(
        `image-${camera.serial}`,
        `No ${what} picture from ${cameraName(camera)}: ${err.message}`,
        err.kind === ERROR_KINDS.OFFLINE ? 'info' : 'warn',
      );
      return null;
    }
    this.images.set(camera.serial, { at: this.now(), image });
    const externalId = cameraIds(this.gladys, camera.serial).device;
    if (this.isCreated(externalId)) {
      try {
        await this.gladys.publishCameraImage(externalId, image);
        this.resolved('camera-image');
      } catch (err) {
        this.problem('camera-image', `Image of ${cameraName(camera)} refused: ${err.message}`);
      }
    }
    return image;
  }

  /** The JPEG of a picture, decrypted with the code of the configuration or the cloud key. */
  async decrypt(camera, bytes) {
    if (!isEncrypted(bytes)) {
      return bytes;
    }
    const candidates = [this.codeOf(camera.serial)];
    if (!this.keys.has(camera.serial)) {
      this.keys.set(
        camera.serial,
        await this.withSession((client) => client.encryptionKey(camera.serial)).catch(() => null),
      );
    }
    candidates.push(this.keys.get(camera.serial));
    for (const code of candidates.filter(Boolean)) {
      try {
        return decryptPicture(bytes, code);
      } catch (err) {
        if (!(err instanceof WrongCodeError)) {
          throw err;
        }
      }
    }
    throw new EzvizError(
      ERROR_KINDS.API,
      'the picture is encrypted: add the verification code of the camera to the configuration',
    );
  }

  /** The timer of the configuration: every added, online, mains-powered camera. */
  async snapshotAll() {
    const half = (this.config?.snapshotIntervalMs ?? 0) / 2;
    for (const camera of this.cameras.values()) {
      const last = this.images.get(camera.serial);
      // A battery camera would be woken up; one imaged half a period ago is fresh.
      if (
        !camera.online ||
        camera.batteryPowered ||
        camera.privacy === true ||
        !this.isCreated(cameraIds(this.gladys, camera.serial).device) ||
        (last && this.now() - last.at < half)
      ) {
        continue;
      }
      await this.cameraImage(camera);
    }
  }

  /**
   * Gladys asks for a fresh image. In Gladys 5.2.1 only the "send camera
   * image" and "ask the AI" scene actions do (camera.getLiveImage): the
   * camera box of the dashboard shows the last image published and never
   * asks. An image of the last 30 seconds is the one of the alarm that
   * started the scene: it is sent as is.
   */
  async getImage(device) {
    const camera = this.findCamera(device.external_id);
    if (!camera) {
      throw new Error(pick(ACTION_TEXT.unknownCamera, this.language));
    }
    // A camera asleep or offline still shows its last picture.
    const image =
      (await this.cameraImage(camera, { reuseMs: this.timings.liveReuseMs })) ??
      this.images.get(camera.serial)?.image;
    if (!image) {
      throw new Error(pick(ACTION_TEXT.snapshotFailed, this.language));
    }
    return image;
  }

  // --- Publishing to Gladys ----------------------------------------------------

  /**
   * The name a person reads for a camera: the one it has in Gladys once added
   * (users rename "C6N(G12345678)" to "Baby monitor"), else the EZVIZ one.
   * The SDK keeps `gladys.devices` up to date on every rename.
   */
  nameOf(camera, language = this.language) {
    const externalId = cameraIds(this.gladys, camera.serial).device;
    const created = (this.gladys.devices ?? []).find((device) => device.external_id === externalId);
    const name = typeof created?.name === 'string' ? created.name.trim() : '';
    return name || cameraName(camera, language);
  }

  /** Whether the user added the device to Gladys. */
  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  get accountUser() {
    return this.client?.session?.user || this.config?.username || null;
  }

  async publishDevices() {
    const devices = [...this.cameras.values()].map((camera) =>
      buildCamera(this.gladys, camera, {
        language: this.language,
        doorbell: this.doorbells.has(camera.serial),
        allowSiren: this.config?.allowSiren,
      }),
    );
    if (this.client && this.read.ok && this.accountUser) {
      devices.push(
        buildAccount(this.gladys, this.accountUser, {
          language: this.language,
          allowArming: this.config.allowArming,
        }),
      );
    }
    const key = JSON.stringify(devices);
    if (key === this.discovery) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovery = key;
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: publish the devices again after a read. */
  async rediscover() {
    this.discovery = null;
    if (!(await this.refresh())) {
      await this.publishDevices();
    }
  }

  /** The user added a device: the SDK forgot its values, send them again. */
  async onDeviceCreated(device) {
    if (
      this.accountUser &&
      device.external_id === accountIds(this.gladys, this.accountUser).device
    ) {
      await this.publishAccountState();
      return;
    }
    const camera = this.findCamera(device.external_id);
    if (!camera) {
      return;
    }
    await this.publishStates(camera);
    await this.publishTransports();
    const image = this.images.get(camera.serial)?.image;
    if (image) {
      await this.gladys.publishCameraImage(device.external_id, image).catch(() => {});
    } else if (!(await this.alarmImage(camera.serial)) && camera.online && !camera.batteryPowered) {
      this.cameraImage(camera).catch(() => {});
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  async publishAllStates() {
    for (const camera of this.cameras.values()) {
      await this.publishStates(camera);
    }
    await this.publishAccountState();
  }

  /** The current values of one camera, sent if they changed. */
  async publishStates(camera) {
    if (!camera) {
      return;
    }
    const ids = cameraIds(this.gladys, camera.serial);
    if (!this.isCreated(ids.device)) {
      return;
    }
    const pulses = this.pulses.get(camera.serial);
    const last = this.alarms.last.get(camera.serial);
    const values = featureValues(
      camera,
      {
        motion: pulses?.has(FEATURE_KEYS.MOTION),
        ring: pulses?.has(FEATURE_KEYS.RING),
        siren: this.sirens.has(camera.serial),
        lastEvent: last ? eventText(last, this.language, this.now()) : null,
      },
      this.language,
    );
    const states = featureKeys(camera, {
      doorbell: this.doorbells.has(camera.serial),
      allowSiren: this.config?.allowSiren,
    })
      .filter((key) => values[key] !== undefined && values[key] !== null)
      .map((key) =>
        typeof values[key] === 'object'
          ? { device_feature_external_id: ids.feature(key), text: values[key].text }
          : { device_feature_external_id: ids.feature(key), state: values[key] },
      );
    await this.sendStates(states, cameraName(camera));
  }

  async publishAccountState() {
    const user = this.accountUser;
    const mode = Object.keys(ARM_MODES).find((key) => ARM_MODES[key] === this.armMode);
    if (!user || !mode) {
      return;
    }
    const ids = accountIds(this.gladys, user);
    if (!this.isCreated(ids.device)) {
      return;
    }
    await this.sendStates(
      [{ device_feature_external_id: ids.feature(FEATURE_KEYS.ARM_MODE), text: mode }],
      'the account',
    );
  }

  async sendStates(states, what) {
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${what} refused: ${err.message}`);
    }
  }

  /** After a read: cameras offline and back, transports, status, widget. */
  async afterChanges(widgetChanged = false) {
    let changed = widgetChanged;
    for (const camera of this.cameras.values()) {
      const before = this.online.get(camera.serial);
      if (before !== undefined && before !== camera.online) {
        // A battery camera asleep reads as offline: not news.
        const line = `${cameraName(camera)} is ${camera.online ? 'online again' : 'offline'}`;
        if (camera.batteryPowered) {
          logger.debug(line);
        } else {
          logger.info(line);
        }
        changed = true;
      }
      if (before === undefined) {
        changed = true;
      }
      this.online.set(camera.serial, camera.online);
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (changed) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const entries = [];
    for (const camera of this.cameras.values()) {
      const externalId = cameraIds(this.gladys, camera.serial).device;
      if (!this.isCreated(externalId)) {
        continue;
      }
      const transport =
        this.read.ok !== false && camera.online
          ? DEVICE_TRANSPORTS.CLOUD
          : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name, in the Configuration screen. */
  connectionStatus() {
    const config = this.config;
    if (config?.serverInvalid) {
      return { connected: false, message: CONNECTION_TEXT.invalidServer };
    }
    if (!this.client) {
      return { connected: false, message: CONNECTION_TEXT.noAccount };
    }
    if (this.blocked) {
      return { connected: false, message: ERROR_TEXT[this.blocked.kind] ?? ERROR_TEXT.api };
    }
    if (this.read.ok === false) {
      return { connected: false, message: ERROR_TEXT[this.read.error.kind] ?? ERROR_TEXT.api };
    }
    if (this.read.ok === null) {
      return null; // first read not done yet
    }
    const ambiguous = this.ambiguousCodes();
    return ambiguous ? { connected: true, message: ambiguous } : { connected: true };
  }

  // --- Verification codes ----------------------------------------------------------

  /** The verification code of a camera: saved by the action, else the configuration. */
  codeOf(serial) {
    return codeFor(this.config, serial, this.store.get('codes') ?? {});
  }

  /**
   * Several codes typed without a serial number cannot be matched to the
   * cameras: none is used, and this message says which serials to write.
   * @returns {object|null} a multi-language message, null when all is clear
   */
  ambiguousCodes() {
    if (!this.config?.codes?.ambiguous) {
      return null;
    }
    // Once every camera has its own code (the action), the old field is moot.
    const missing = [...this.cameras.values()].filter((camera) => !this.codeOf(camera.serial));
    if (missing.length === 0) {
      return null;
    }
    const list = missing.map((camera) => `${this.nameOf(camera)} (${camera.serial})`).join(', ');
    return localized((language) => CODE_TEXT[language].ambiguous(list));
  }

  /**
   * "Set a camera verification code": the code of one camera, kept in /data
   * (an empty code removes it), checked on its last alarm picture when that
   * one is encrypted. Never logged.
   */
  async setCameraCode(externalId, raw) {
    const camera = this.requireCamera(externalId);
    const code = typeof raw === 'string' ? raw.trim() : raw ? String(raw).trim() : '';
    const name = cameraName(camera);
    const say = (key) =>
      localized((language) => CODE_TEXT[language][key](this.nameOf(camera, language)));
    if (code && !isCode(code)) {
      return localized((language) => CODE_TEXT[language].invalid());
    }
    const codes = { ...(this.store.get('codes') ?? {}) };
    if (code) {
      codes[camera.serial.toUpperCase()] = code;
    } else {
      delete codes[camera.serial.toUpperCase()];
    }
    await this.store.set('codes', codes);
    this.keys.delete(camera.serial);
    await this.publishConnectionStatus();
    if (!code) {
      logger.info(`Configuration action: verification code of ${name} removed`);
      return say('removed');
    }
    logger.info(`Configuration action: verification code of ${name} saved`);
    const verdict = await this.checkCode(camera, code);
    if (verdict === true) {
      // The picture the code opens is shown at once.
      this.alarmImage(camera.serial).catch(() => {});
    }
    return say(verdict === true ? 'checked' : verdict === false ? 'wrong' : 'saved');
  }

  /** Whether a code opens the last alarm picture: true, false, or null when it cannot tell. */
  async checkCode(camera, code) {
    const picture = this.alarms.last.get(camera.serial)?.picture;
    if (!picture) {
      return null;
    }
    try {
      const bytes = await this.withSession((client) => client.download(picture));
      if (!isEncrypted(bytes)) {
        return null;
      }
      decryptPicture(bytes, code);
      return true;
    } catch (err) {
      return err instanceof WrongCodeError ? false : null;
    }
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    if (!status) {
      return;
    }
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands ------------------------------------------------------------------

  /** The camera of a Gladys external id, null when unknown. */
  findCamera(externalId) {
    if (!externalId) {
      return null;
    }
    for (const camera of this.cameras.values()) {
      if (cameraIds(this.gladys, camera.serial).device === externalId) {
        return camera;
      }
    }
    return null;
  }

  requireClient() {
    if (!this.client) {
      throw new Error(pick(ACTION_TEXT.notConfigured, this.language));
    }
    return this.client;
  }

  /** The camera a scene action or a Configuration action names. */
  requireCamera(externalId) {
    this.requireClient();
    if (!externalId) {
      throw new Error(pick(ACTION_TEXT.pickCamera, this.language));
    }
    const camera = this.findCamera(externalId);
    if (!camera) {
      throw new Error(pick(ACTION_TEXT.unknownCamera, this.language));
    }
    return camera;
  }

  /** A command from Gladys: a camera feature or the arming mode. */
  async setValue(device, feature, value) {
    if (
      this.accountUser &&
      device.external_id === accountIds(this.gladys, this.accountUser).device
    ) {
      await this.setArmMode(String(value), 'Gladys');
      return;
    }
    const camera = this.findCamera(device.external_id);
    const key = feature.external_id.slice(device.external_id.length + 1);
    if (!camera || !feature.external_id.startsWith(`${device.external_id}:`)) {
      throw new Error(`No command for ${feature.external_id}`);
    }
    const on = Number(value) === 1;
    const name = cameraName(camera);
    const say = (what) => logger.info(`${name}: ${what}`);
    const hold = (field, state) => {
      camera[field] = state;
      this.held.set(`${camera.serial}:${field}`, {
        value: state,
        until: this.now() + this.timings.holdMs,
      });
    };
    await this.command(name, async () => {
      switch (key) {
        case FEATURE_KEYS.MOVE: {
          const direction = MOVES[Number(value)];
          if (direction && camera.ptz) {
            await this.withSession((client) => client.move(camera.serial, direction));
            say(`moved ${direction}`);
          }
          return;
        }
        case FEATURE_KEYS.DETECTION:
          await this.withSession((client) => client.setDetection(camera.serial, on));
          hold('detection', on);
          say(`motion detection ${on ? 'on' : 'off'}`);
          break;
        case FEATURE_KEYS.PRIVACY:
          await this.withSession((client) => client.setSwitch(camera.serial, SWITCHES.PRIVACY, on));
          hold('privacy', on);
          say(`privacy mode ${on ? 'on' : 'off'}`);
          break;
        case FEATURE_KEYS.LIGHT:
          await this.withSession((client) =>
            client.setSwitch(camera.serial, SWITCHES.ALARM_LIGHT, on),
          );
          hold('light', on);
          say(`floodlight ${on ? 'on' : 'off'}`);
          break;
        case FEATURE_KEYS.SIREN:
          if (!this.config.allowSiren || !camera.sirenCapable) {
            throw new Error(`No command for ${feature.external_id}`);
          }
          await this.withSession((client) => client.setSiren(camera.serial, on));
          this.siren(camera, on);
          say(`siren ${on ? 'on' : 'off'}`);
          break;
        default:
          throw new Error(`No command for ${feature.external_id}`);
      }
    });
    await this.publishStates(camera);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Run a command; its failure is one warning line, then thrown to Gladys. */
  async command(name, run) {
    try {
      await run();
    } catch (err) {
      logger.warn(`${name}: command failed: ${err.message}`);
      if (err instanceof EzvizError) {
        throw new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT.api, this.language), {
          cause: err,
        });
      }
      throw err;
    }
  }

  /** The siren state: on for the minute the firmware lets it sound. */
  siren(camera, on) {
    clearTimeout(this.sirens.get(camera.serial));
    if (!on) {
      this.sirens.delete(camera.serial);
      return;
    }
    const timer = setTimeout(() => {
      this.sirens.delete(camera.serial);
      if (!this.stopped) {
        this.publishStates(this.cameras.get(camera.serial)).catch(() => {});
      }
    }, this.timings.sirenMs);
    timer.unref?.();
    this.sirens.set(camera.serial, timer);
  }

  /**
   * The arming mode of the account: `home`, `away` or `sleep`.
   * @param {string} mode
   * @param {string} from who asked (for the log line)
   */
  async setArmMode(mode, from) {
    if (!this.config?.allowArming) {
      throw new Error(pick(ACTION_TEXT.armingDisabled, this.language));
    }
    const value = ARM_MODES[mode];
    if (!value) {
      throw new Error(`Unknown arming mode ${mode}`);
    }
    this.requireClient();
    await this.command('EZVIZ account', () =>
      this.withSession((client) => client.setDefenceMode(value)),
    );
    this.armMode = value;
    logger.info(`${from}: arming mode set to ${mode}`);
    await this.publishAccountState();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Scene action: one pan/tilt step. */
  async moveCamera(externalId, direction) {
    const camera = this.requireCamera(externalId);
    if (!camera.ptz) {
      throw new Error(pick(ACTION_TEXT.notPtz, this.language));
    }
    if (!Object.values(MOVES).includes(direction)) {
      throw new Error(`Unknown direction ${direction}`);
    }
    await this.command(cameraName(camera), () =>
      this.withSession((client) => client.move(camera.serial, direction)),
    );
    logger.info(`Scene action: ${cameraName(camera)} moved ${direction}`);
  }

  /** Scene action: a fresh capture now, sent to Gladys. */
  async refreshSnapshot(externalId) {
    const camera = this.requireCamera(externalId);
    logger.info(`Scene action: fresh image of ${cameraName(camera)}`);
    const image = await this.cameraImage(camera, { fresh: true });
    if (!image) {
      throw new Error(pick(ACTION_TEXT.snapshotFailed, this.language));
    }
    return image;
  }

  // --- Configuration actions -------------------------------------------------------

  /** "Test the connection": log in if needed (once), read, report in four languages. */
  async testConnection() {
    if (!this.client) {
      return this.config?.serverInvalid ? CONNECTION_TEXT.invalidServer : CONNECTION_TEXT.noAccount;
    }
    // The user asked: one login attempt, even after a refusal.
    this.blocked = null;
    this.resolved('login');
    const ok = await this.refresh();
    if (!ok) {
      const err = this.blocked ?? this.read.error;
      logger.info(`Connection test: failed (${err?.message ?? 'no answer'})`);
      await this.publishConnectionStatus();
      return ERROR_TEXT[err?.kind] ?? ERROR_TEXT.api;
    }
    logger.info('Connection test: success');
    const encrypted = [...this.cameras.values()].filter(
      (camera) => camera.encrypted && !this.codeOf(camera.serial),
    ).length;
    return localized((language) => {
      const text = REPORT_TEXT[language];
      const parts = [text.ok(this.cameras.size, this.client.apiDomain)];
      if (encrypted > 0) {
        parts.push(text.encrypted(encrypted));
      }
      const ambiguous = this.ambiguousCodes();
      if (ambiguous) {
        parts.push(ambiguous[language]);
      }
      return parts.join(' ');
    });
  }

  /**
   * "Enter the verification code": log in with the code EZVIZ sent; an empty
   * code asks EZVIZ for a new one.
   */
  async verifyCode(raw) {
    if (!this.client) {
      return this.config?.serverInvalid ? CONNECTION_TEXT.invalidServer : CONNECTION_TEXT.noAccount;
    }
    const code = typeof raw === 'string' ? raw.trim() : raw ? String(raw) : '';
    if (!code) {
      if (this.client.loggedIn && this.read.ok) {
        return ACTION_TEXT.noCodeNeeded;
      }
      try {
        await this.client.sendCode(this.config.username);
      } catch (err) {
        logger.info(`Verification code: not sent (${err.message})`);
        return ERROR_TEXT[err.kind] ?? ERROR_TEXT.api;
      }
      logger.info('Verification code: a new one was requested');
      return ACTION_TEXT.codeSent;
    }
    try {
      await this.client.login({
        username: this.config.username,
        password: this.config.password,
        code,
      });
    } catch (err) {
      logger.info(`Verification code: refused (${err.message})`);
      if (err.kind !== ERROR_KINDS.UNREACHABLE) {
        this.blocked = err;
      }
      await this.publishConnectionStatus();
      return ERROR_TEXT[err.kind] ?? ERROR_TEXT.api;
    }
    this.loggedIn();
    await this.refresh();
    return ACTION_TEXT.codeAccepted;
  }

  /**
   * "Show the RTSP address": the local stream of a camera, user `admin` and
   * its verification code as password, for the "RTSP camera" integration of
   * Gladys. Shown to the user, never logged.
   */
  streamUrl(externalId) {
    const camera = this.requireCamera(externalId);
    const code = this.codeOf(camera.serial);
    if (!camera.localIp) {
      return ACTION_TEXT.noLocalAddress;
    }
    if (!code) {
      return ACTION_TEXT.streamNoCode;
    }
    const url = `rtsp://admin:${code}@${camera.localIp}:${camera.rtspPort}/Streaming/Channels/101`;
    logger.info(`Configuration action: RTSP address of ${cameraName(camera)} shown`);
    return localized((language) => `${pick(ACTION_TEXT.stream, language)} ${url}`);
  }

  // --- Widget ----------------------------------------------------------------------

  /** What the widget shows. */
  view() {
    return {
      configured: Boolean(this.client),
      reachable: this.blocked ? false : this.read.ok,
      error: this.blocked ?? this.read.error,
      cameras: [...this.cameras.values()],
      armMode: Object.keys(ARM_MODES).find((key) => ARM_MODES[key] === this.armMode) ?? null,
      allowArming: Boolean(this.config?.allowArming),
      lastAlarms: this.alarms.last,
      now: this.now(),
      cameraId: (camera) => cameraIds(this.gladys, camera.serial).device,
      nameOf: (camera, language) => this.nameOf(camera, language),
      // The account device is listed with the cameras in every `devices`
      // select (Gladys 5.2.1 cannot filter that source): not a camera.
      isAccountId: (id) =>
        Boolean(this.accountUser) && id === accountIds(this.gladys, this.accountUser).device,
    };
  }

  /** The raw base64 of a widget image. */
  thumbnail(key) {
    const image = this.thumbnails.get(key);
    if (!image) {
      throw new Error(`Unknown image ${key}`);
    }
    return image;
  }
}
