// -----------------------------------------------------------------------------
// The Gladys devices of an EZVIZ account: one per camera or doorbell, and one
// for the account itself (its arming mode).
//
// Identity: the serial number EZVIZ gives each camera (`gladys.externalIds(
// 'camera', serial)`), and for the account a hash of the EZVIZ user id — never
// a name. Feature keys are permanent once published (test/gladys-rules.test.js
// checks the couples).
//
// Camera features (category/type couples of the core table), each one only
// when the camera has it:
//   image        camera/image          last alarm picture, captures
//   move         camera/move           pan/tilt arrows (PTZ models), one step
//   motion       motion-sensor/binary  1 for a minute after a detection
//   ring         doorbell/ring         doorbells: 1 → 0 pulse, as the core expects
//   last_event   text/text             "Person · 18:32"
//   online       input/binary          shown On/Off
//   detection    switch/binary         motion detection on/off (the "alarm
//                                      notification" of the EZVIZ app)
//   privacy      switch/binary         lens cover (privacy mode)
//   sleep        switch/binary         sleep mode (no video, no detection)
//   light        light/binary          floodlight
//   siren        siren/binary          only when allowed in the configuration
//   battery      battery/integer       battery models
//   wifi         signal/integer        Wi-Fi signal, 0-100
//   sd_state     text/text             SD card: normal, no card, error...
//   sd_capacity  data/size (GB)        SD card size
// Account: arm_mode text/select (at home / away / sleep), read-only unless
// arming is allowed in the configuration.
//
// Devices are published with should_poll: false: the integration reads the
// cloud on its own timers (src/hub.js), never waiting for Gladys to poll
// (GladysAssistant/Gladys#3198).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { createHash } from 'node:crypto';
import { ARM_MODES } from './ezviz/model.js';
import { ARM_MODE_NAMES, SD_STATE_NAMES, pick } from './texts.js';

export const CAMERA_TYPE = 'camera';
export const ACCOUNT_TYPE = 'account';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  IMAGE: 'image',
  MOVE: 'move',
  MOTION: 'motion',
  RING: 'ring',
  LAST_EVENT: 'last_event',
  ONLINE: 'online',
  DETECTION: 'detection',
  PRIVACY: 'privacy',
  SLEEP: 'sleep',
  LIGHT: 'light',
  SIREN: 'siren',
  BATTERY: 'battery',
  WIFI: 'wifi',
  SD_STATE: 'sd_state',
  SD_CAPACITY: 'sd_capacity',
  ARM_MODE: 'arm_mode',
});

// Values of camera/move (the core's CAMERA.MOVE): 0 stop, 1 pan left, 2 pan
// right, 3 tilt up, 4 tilt down. EZVIZ moves one step per command.
export const MOVES = Object.freeze({ 1: 'left', 2: 'right', 3: 'up', 4: 'down' });

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    image: 'Image',
    move: 'Pan and tilt',
    motion: 'Motion',
    ring: 'Doorbell ring',
    last_event: 'Last event',
    online: 'Online',
    detection: 'Motion detection',
    privacy: 'Privacy mode',
    sleep: 'Sleep mode',
    light: 'Floodlight',
    siren: 'Siren',
    battery: 'Battery',
    wifi: 'Wi-Fi signal',
    sd_state: 'SD card',
    sd_capacity: 'SD card size',
    arm_mode: 'Arming mode',
  },
  fr: {
    image: 'Image',
    move: 'Orientation',
    motion: 'Mouvement',
    ring: 'Sonnette',
    last_event: 'Dernier événement',
    online: 'En ligne',
    detection: 'Détection de mouvement',
    privacy: 'Mode confidentialité',
    sleep: 'Mode veille',
    light: 'Projecteur',
    siren: 'Sirène',
    battery: 'Batterie',
    wifi: 'Signal Wi-Fi',
    sd_state: 'Carte SD',
    sd_capacity: 'Taille de la carte SD',
    arm_mode: 'Mode d’armement',
  },
  de: {
    image: 'Bild',
    move: 'Schwenken und Neigen',
    motion: 'Bewegung',
    ring: 'Türklingel',
    last_event: 'Letztes Ereignis',
    online: 'Online',
    detection: 'Bewegungserkennung',
    privacy: 'Privatsphäre-Modus',
    sleep: 'Ruhemodus',
    light: 'Flutlicht',
    siren: 'Sirene',
    battery: 'Batterie',
    wifi: 'WLAN-Signal',
    sd_state: 'SD-Karte',
    sd_capacity: 'Größe der SD-Karte',
    arm_mode: 'Scharfschaltmodus',
  },
  es: {
    image: 'Imagen',
    move: 'Orientación',
    motion: 'Movimiento',
    ring: 'Timbre',
    last_event: 'Último evento',
    online: 'En línea',
    detection: 'Detección de movimiento',
    privacy: 'Modo privacidad',
    sleep: 'Modo reposo',
    light: 'Foco',
    siren: 'Sirena',
    battery: 'Batería',
    wifi: 'Señal wifi',
    sd_state: 'Tarjeta SD',
    sd_capacity: 'Tamaño de la tarjeta SD',
    arm_mode: 'Modo de armado',
  },
};

// Names of the devices EZVIZ did not name, and of the account device.
export const DEVICE_NAMES = {
  en: { camera: 'EZVIZ camera', account: 'EZVIZ account' },
  fr: { camera: 'Caméra EZVIZ', account: 'Compte EZVIZ' },
  de: { camera: 'EZVIZ-Kamera', account: 'EZVIZ-Konto' },
  es: { camera: 'Cámara EZVIZ', account: 'Cuenta EZVIZ' },
};

// Directions of camera/move, as the arrows of the dashboard read them.
export const MOVE_NAMES = {
  en: { 1: 'Left', 2: 'Right', 3: 'Up', 4: 'Down' },
  fr: { 1: 'Gauche', 2: 'Droite', 3: 'Haut', 4: 'Bas' },
  de: { 1: 'Links', 2: 'Rechts', 3: 'Hoch', 4: 'Runter' },
  es: { 1: 'Izquierda', 2: 'Derecha', 3: 'Arriba', 4: 'Abajo' },
};

const sensor = (category, type = DEVICE_FEATURE_TYPES.SENSOR.BINARY, extra = {}) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

const command = (category, type) => ({
  category,
  type,
  read_only: false,
  has_feedback: true,
  keep_history: true,
  min: 0,
  max: 1,
});

// Text features have no bounds, but min/max are NOT NULL in Gladys.
const text = () => ({
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 0,
});

const DEFINITIONS = {
  [FEATURE_KEYS.IMAGE]: {
    category: DEVICE_FEATURE_CATEGORIES.CAMERA,
    type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
    read_only: true,
    has_feedback: false,
    // Images travel on their own channel, never in the states history.
    keep_history: false,
    min: 0,
    max: 0,
  },
  [FEATURE_KEYS.MOVE]: {
    category: DEVICE_FEATURE_CATEGORIES.CAMERA,
    type: DEVICE_FEATURE_TYPES.CAMERA.MOVE,
    read_only: false,
    has_feedback: false,
    keep_history: false,
    min: 0,
    max: 6,
  },
  [FEATURE_KEYS.MOTION]: sensor(DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR),
  [FEATURE_KEYS.RING]: sensor(
    DEVICE_FEATURE_CATEGORIES.DOORBELL,
    DEVICE_FEATURE_TYPES.DOORBELL.RING,
  ),
  [FEATURE_KEYS.LAST_EVENT]: text(),
  [FEATURE_KEYS.ONLINE]: sensor(DEVICE_FEATURE_CATEGORIES.INPUT),
  [FEATURE_KEYS.DETECTION]: command(
    DEVICE_FEATURE_CATEGORIES.SWITCH,
    DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  ),
  [FEATURE_KEYS.PRIVACY]: command(
    DEVICE_FEATURE_CATEGORIES.SWITCH,
    DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  ),
  [FEATURE_KEYS.SLEEP]: command(
    DEVICE_FEATURE_CATEGORIES.SWITCH,
    DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  ),
  [FEATURE_KEYS.LIGHT]: command(DEVICE_FEATURE_CATEGORIES.LIGHT, DEVICE_FEATURE_TYPES.LIGHT.BINARY),
  [FEATURE_KEYS.SIREN]: command(DEVICE_FEATURE_CATEGORIES.SIREN, DEVICE_FEATURE_TYPES.SIREN.BINARY),
  [FEATURE_KEYS.BATTERY]: sensor(
    DEVICE_FEATURE_CATEGORIES.BATTERY,
    DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
    { unit: DEVICE_FEATURE_UNITS.PERCENT, max: 100 },
  ),
  [FEATURE_KEYS.WIFI]: sensor(
    DEVICE_FEATURE_CATEGORIES.SIGNAL,
    DEVICE_FEATURE_TYPES.SIGNAL.QUALITY,
    {
      max: 100,
    },
  ),
  [FEATURE_KEYS.SD_STATE]: text(),
  [FEATURE_KEYS.SD_CAPACITY]: sensor(
    DEVICE_FEATURE_CATEGORIES.DATA,
    DEVICE_FEATURE_TYPES.DATA.SIZE,
    {
      unit: DEVICE_FEATURE_UNITS.GIGABYTE,
      max: 2048,
    },
  ),
};

/** External ids of a camera and its features. */
export const cameraIds = (gladys, serial) => gladys.externalIds(CAMERA_TYPE, serial);

/** The stable platform id of an account: a hash of its EZVIZ user id. */
export const accountKey = (user) =>
  createHash('sha256').update(String(user)).digest('hex').slice(0, 16);

export const accountIds = (gladys, user) => gladys.externalIds(ACCOUNT_TYPE, accountKey(user));

/**
 * The feature keys of a camera, in display order.
 * @param {object} camera a parsed camera (src/ezviz/model.js)
 * @param {object} [options]
 * @param {boolean} [options.doorbell] the camera was seen ringing
 * @param {boolean} [options.allowSiren] the siren may be driven from Gladys
 */
export function featureKeys(camera, { doorbell = false, allowSiren = false } = {}) {
  return [
    FEATURE_KEYS.IMAGE,
    camera.ptz && FEATURE_KEYS.MOVE,
    FEATURE_KEYS.MOTION,
    (camera.doorbell || doorbell) && FEATURE_KEYS.RING,
    FEATURE_KEYS.LAST_EVENT,
    FEATURE_KEYS.ONLINE,
    camera.detection !== null && FEATURE_KEYS.DETECTION,
    camera.privacyCapable && FEATURE_KEYS.PRIVACY,
    camera.sleepCapable && FEATURE_KEYS.SLEEP,
    camera.lightCapable && FEATURE_KEYS.LIGHT,
    camera.sirenCapable && allowSiren && FEATURE_KEYS.SIREN,
    camera.battery !== null && FEATURE_KEYS.BATTERY,
    camera.wifiSignal !== null && FEATURE_KEYS.WIFI,
    camera.sd && FEATURE_KEYS.SD_STATE,
    camera.sd?.capacityGb && FEATURE_KEYS.SD_CAPACITY,
  ].filter(Boolean);
}

/** The name shown for a camera: the account's, else "EZVIZ camera" and its serial end. */
export function cameraName(camera, language = 'en') {
  if (camera.name) {
    return camera.name;
  }
  const names = DEVICE_NAMES[language] ?? DEVICE_NAMES.en;
  return `${names.camera} ${String(camera.serial).slice(-6)}`;
}

/**
 * The discovery payload of a camera.
 * @param {object} gladys SDK client
 * @param {object} camera a parsed camera
 * @param {object} [options] language, doorbell, allowSiren
 */
export function buildCamera(
  gladys,
  camera,
  { language = 'en', doorbell = false, allowSiren = false, liveUrl = null } = {},
) {
  const ids = cameraIds(gladys, camera.serial);
  const names = NAMES[language] ?? NAMES.en;
  const moves = MOVE_NAMES[language] ?? MOVE_NAMES.en;
  return {
    name: cameraName(camera, language),
    external_id: ids.device,
    ...(camera.model ? { model: `EZVIZ ${camera.model}` } : {}),
    should_poll: false,
    // The live view of the dashboard camera box: the core's rtsp-camera
    // service plays the CAMERA_URL param of any camera device (as the
    // Netatmo integration does). Only when the local address and the
    // verification code are known.
    ...(liveUrl ? { params: [{ name: 'CAMERA_URL', value: liveUrl }] } : {}),
    features: featureKeys(camera, { doorbell, allowSiren }).map((key) => ({
      ...DEFINITIONS[key],
      name: names[key],
      external_id: ids.feature(key),
      ...(key === FEATURE_KEYS.MOVE
        ? {
            supported_options: Object.keys(MOVES).map((value, index) => ({
              value: Number(value),
              label: moves[value],
              sort_order: index,
            })),
          }
        : {}),
    })),
  };
}

/** The discovery payload of the account: its arming mode. */
export function buildAccount(gladys, user, { language = 'en', allowArming = true } = {}) {
  const ids = accountIds(gladys, user);
  const modes = ARM_MODE_NAMES[language] ?? ARM_MODE_NAMES.en;
  return {
    name: pick(DEVICE_NAMES, language).account,
    external_id: ids.device,
    model: 'EZVIZ',
    should_poll: false,
    features: [
      {
        name: (NAMES[language] ?? NAMES.en).arm_mode,
        external_id: ids.feature(FEATURE_KEYS.ARM_MODE),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
        // NOT NULL in Gladys even for a text feature.
        min: 0,
        max: 0,
        read_only: !allowArming,
        has_feedback: true,
        keep_history: true,
        supported_options: Object.keys(ARM_MODES).map((value, index) => ({
          value,
          label: modes[value],
          sort_order: index,
        })),
      },
    ],
  };
}

const flag = (value) => (value ? 1 : 0);

/**
 * The value of every feature of a camera (null or undefined: nothing to
 * publish). Text values are `{ text }`.
 * @param {object} camera a parsed camera
 * @param {object} live { motion, ring, siren, lastEvent: string|null }
 * @param {string} language
 */
export function featureValues(camera, live = {}, language = 'en') {
  const sdNames = SD_STATE_NAMES[language] ?? SD_STATE_NAMES.en;
  return {
    [FEATURE_KEYS.MOTION]: flag(live.motion),
    [FEATURE_KEYS.RING]: flag(live.ring),
    [FEATURE_KEYS.LAST_EVENT]: live.lastEvent ? { text: live.lastEvent } : null,
    [FEATURE_KEYS.ONLINE]: flag(camera.online),
    [FEATURE_KEYS.DETECTION]: camera.detection === null ? null : flag(camera.detection),
    [FEATURE_KEYS.PRIVACY]: camera.privacy === null ? null : flag(camera.privacy),
    [FEATURE_KEYS.SLEEP]: camera.sleep === null ? null : flag(camera.sleep),
    [FEATURE_KEYS.LIGHT]: flag(camera.light),
    [FEATURE_KEYS.SIREN]: flag(live.siren),
    [FEATURE_KEYS.BATTERY]: camera.battery,
    [FEATURE_KEYS.WIFI]: camera.wifiSignal,
    [FEATURE_KEYS.SD_STATE]: camera.sd ? { text: sdNames[camera.sd.state] } : null,
    [FEATURE_KEYS.SD_CAPACITY]: camera.sd?.capacityGb ?? null,
  };
}
