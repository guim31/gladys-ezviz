// -----------------------------------------------------------------------------
// The EZVIZ payloads, turned into plain records the rest of the code reads.
//
// The device list (pagelist) gives each section keyed by serial:
//   deviceInfos[]     name, deviceCategory, deviceSubCategory, deviceType,
//                     status (1 online, 2 offline or asleep), supportExt
//                     (a JSON string of capability numbers → values)
//   STATUS[serial]    globalStatus (motion detection on), isEncrypt (pictures
//                     encrypted), diskNum, diskState, optionals { powerRemaining,
//                     diskCapacity, timeZone, ... }
//   SWITCH[serial]    [{ type, enable }] — privacy 7, floodlight 303, ...
//   WIFI[serial]      { signal (0-100), address }
//   CONNECTION[serial]{ localIp, localRtspPort }
// Capabilities (pyezvizapi SupportExt, read as Home Assistant reads them):
//   154 SupportPtz == "1", 113 SupportAlarmLight == "1", 96
//   SupportActiveDefense (siren) != "0", 40 SupportPtzPrivacy present,
//   4 SupportDisk == "1".
//
// An alarm (unified message list) gives msgId, deviceSerial, time (epoch ms),
// timeStr (camera clock), title / detail / sampleName, subType, ext {
// alarmType, pics }, pic, defaultPic. Its kind — motion, person, doorbell —
// comes from the alarm type code when it is a known one, else from the title
// EZVIZ writes in English (the requests ask for English).
// -----------------------------------------------------------------------------

export const CAMERA_CATEGORIES = new Set(['IPC', 'BatteryCamera', 'BDoorBell', 'CatEye']);
export const DOORBELL_CATEGORIES = new Set(['BDoorBell', 'CatEye']);
export const BATTERY_CATEGORY = 'BatteryCamera';

// EZVIZ switch type numbers (pyezvizapi DeviceSwitchType).
export const SWITCHES = Object.freeze({ PRIVACY: 7, ALARM_LIGHT: 303 });

// EZVIZ capability numbers (pyezvizapi SupportExt).
export const SUPPORT = Object.freeze({
  DISK: '4',
  PTZ_PRIVACY: '40',
  ACTIVE_DEFENSE: '96',
  ALARM_LIGHT: '113',
  PTZ: '154',
});

// Arming modes of the account (pyezvizapi DefenseModeType): the keys are the
// option values Gladys stores, permanent once published.
export const ARM_MODES = Object.freeze({ home: 1, away: 2, sleep: 3 });

export const ALARM_KINDS = Object.freeze({
  MOTION: 'motion',
  PERSON: 'person',
  DOORBELL: 'doorbell',
  OTHER: 'other',
});

// Alarm type codes of the EZVIZ / Hik-Connect open platform: 10000 PIR,
// 10002 motion detection, 10016 smart doorbell. The other codes vary by model
// and are recognised by their title.
const KIND_BY_CODE = {
  10000: ALARM_KINDS.MOTION,
  10002: ALARM_KINDS.MOTION,
  10016: ALARM_KINDS.DOORBELL,
};
const KIND_BY_TITLE = [
  [ALARM_KINDS.DOORBELL, /\b(door ?bell|ring|rang|ringing|call|calling|visitor)\b/i],
  [ALARM_KINDS.PERSON, /\b(human|humans|person|people|pedestrian|humanoid)\b/i],
  [ALARM_KINDS.MOTION, /\b(motion|movement|moving|pir|intrusion|line crossing)\b/i],
];

const SD_STATES = { 0: 'normal', 1: 'error', 2: 'unformatted', 3: 'formatting' };

/** A value of STATUS.optionals, decoded when EZVIZ sent it as a JSON string. */
function optional(optionals, key) {
  const value = optionals?.[key];
  if (typeof value === 'string' && /^[[{]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function parseSupport(raw) {
  if (raw && typeof raw === 'object') {
    return raw;
  }
  if (typeof raw === 'string' && raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

/** Whether a pagelist entry is a camera the integration handles. */
export function isCamera(info) {
  if (!info || typeof info.deviceSerial !== 'string' || !info.deviceSerial) {
    return false;
  }
  // A Hikvision camera linked to the account shows as COMMON.
  return (
    CAMERA_CATEGORIES.has(info.deviceCategory) ||
    (info.deviceCategory === 'COMMON' && info.hik === true)
  );
}

/** The SD card of a camera, or null when it has no slot. */
function sdCard(support, status) {
  if (String(support[SUPPORT.DISK] ?? '') !== '1') {
    return null;
  }
  const count = toNumber(status?.diskNum) ?? 0;
  const first = String(status?.diskState ?? '-').charAt(0);
  if (count < 1 || first === '-' || first === '') {
    return { state: 'absent', capacityGb: null };
  }
  const megabytes = toNumber(
    String(optional(status?.optionals, 'diskCapacity') ?? '').split(',')[0],
  );
  return {
    state: SD_STATES[first] ?? 'error',
    capacityGb: megabytes !== null && megabytes > 0 ? Math.round(megabytes / 102.4) / 10 : null,
  };
}

/**
 * One camera of the device list, as a plain record.
 * @param {object} info an entry of deviceInfos
 * @param {object} sections the whole pagelist (STATUS, SWITCH, WIFI, CONNECTION…)
 */
export function parseCamera(info, sections = {}) {
  const serial = info.deviceSerial;
  const status = sections.STATUS?.[serial] ?? {};
  const optionals = status.optionals ?? {};
  const support = parseSupport(info.supportExt);
  const switches = new Map();
  for (const item of Array.isArray(sections.SWITCH?.[serial]) ? sections.SWITCH[serial] : []) {
    if (item && Number.isInteger(item.type) && typeof item.enable !== 'undefined') {
      switches.set(item.type, Boolean(item.enable));
    }
  }
  const wifi = sections.WIFI?.[serial] ?? {};
  const connection = sections.CONNECTION?.[serial] ?? {};
  const battery = toNumber(optional(optionals, 'powerRemaining'));
  const signal = toNumber(wifi.signal);
  const localIp = [wifi.address, connection.localIp].find(
    (address) => typeof address === 'string' && address && address !== '0.0.0.0',
  );
  const rtspPort = toNumber(connection.localRtspPort);
  const has = (key) => String(support[key] ?? '0');
  return {
    serial,
    name: typeof info.name === 'string' && info.name.trim() ? info.name.trim() : null,
    category: info.deviceCategory,
    model: info.deviceSubCategory || info.deviceType || null,
    version: info.version ?? null,
    online: Number(info.status) === 1,
    battery: battery !== null && battery >= 0 && battery <= 100 ? Math.round(battery) : null,
    batteryPowered: info.deviceCategory === BATTERY_CATEGORY || battery !== null,
    wifiSignal: signal !== null && signal >= 0 && signal <= 100 ? Math.round(signal) : null,
    detection: status.globalStatus === undefined ? null : Number(status.globalStatus) === 1,
    encrypted: Number(status.isEncrypt) === 1,
    doorbell: DOORBELL_CATEGORIES.has(info.deviceCategory),
    ptz: has(SUPPORT.PTZ) === '1',
    privacyCapable: support[SUPPORT.PTZ_PRIVACY] !== undefined && switches.has(SWITCHES.PRIVACY),
    privacy: switches.get(SWITCHES.PRIVACY) ?? null,
    lightCapable: has(SUPPORT.ALARM_LIGHT) === '1',
    light: switches.get(SWITCHES.ALARM_LIGHT) ?? false,
    sirenCapable: has(SUPPORT.ACTIVE_DEFENSE) !== '0',
    sd: sdCard(support, status),
    localIp: localIp ?? null,
    rtspPort: rtspPort && rtspPort > 0 ? rtspPort : 554,
    timeZone: optional(optionals, 'timeZone') ?? null,
  };
}

/** Every camera of a device list, in the order of the account. */
export function parseDeviceList(list) {
  const infos = Array.isArray(list?.deviceInfos) ? list.deviceInfos : [];
  return infos.filter(isCamera).map((info) => parseCamera(info, list));
}

/** Minutes east of UTC of an EZVIZ time zone ("UTC+02:00", "GMT-5"), or null. */
export function parseOffset(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value
    .trim()
    .toUpperCase()
    .replace(/^(UTC|GMT)/, '')
    .match(/^([+-]?)(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

/**
 * The instant of an alarm, in epoch milliseconds. EZVIZ sends an epoch and the
 * camera clock as text; some firmware sends the camera clock as the epoch: when
 * both disagree by more than two minutes, the text read in the camera time
 * zone wins (as pyezvizapi does).
 */
export function alarmInstant(message, timeZone) {
  let epoch = toNumber(message.time ?? message.alarmTime ?? message.alarmStartTime);
  if (epoch !== null && epoch < 1e12) {
    epoch *= 1000; // seconds
  }
  const offset = parseOffset(timeZone);
  const text = message.timeStr ?? message.ext?.alarmStartTime;
  const parts =
    typeof text === 'string' && text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (parts && offset !== null) {
    const [, y, mo, d, h, mi, s] = parts.map(Number);
    const fromText = Date.UTC(y, mo - 1, d, h, mi, s) - offset * 60_000;
    if (epoch === null || Math.abs(epoch - fromText) > 120_000) {
      return fromText;
    }
  }
  return epoch;
}

/** motion, person, doorbell or other, from the code then the title. */
export function classifyAlarm(code, title) {
  const known = KIND_BY_CODE[String(code)];
  if (known) {
    return known;
  }
  for (const [kind, pattern] of KIND_BY_TITLE) {
    if (pattern.test(title ?? '')) {
      return kind;
    }
  }
  return ALARM_KINDS.OTHER;
}

/**
 * One alarm of the unified message list, as a plain record; null when it has
 * no camera or no identity.
 * @param {object} message an entry of the list
 * @param {(serial: string) => string|null} [timeZoneOf]
 */
export function parseAlarm(message, timeZoneOf = () => null) {
  if (!message || typeof message !== 'object' || typeof message.deviceSerial !== 'string') {
    return null;
  }
  const ext = message.ext && typeof message.ext === 'object' ? message.ext : {};
  const id = message.msgId ?? message.alarmId;
  if (id === undefined || id === null || id === '') {
    return null;
  }
  const title = String(message.title || message.detail || message.sampleName || '').trim();
  const code = String(ext.alarmType ?? message.alarmType ?? message.subType ?? '');
  const pictures = [message.pic, ext.pics, message.picUrl]
    .filter((value) => typeof value === 'string')
    .flatMap((value) => value.split(';'))
    .map((value) => value.trim())
    .filter((value) => value.startsWith('https://'));
  return {
    id: String(id),
    serial: message.deviceSerial,
    at: alarmInstant(message, timeZoneOf(message.deviceSerial)),
    title: title.slice(0, 200),
    code,
    kind: classifyAlarm(code, title),
    picture: pictures[0] ?? null,
  };
}
