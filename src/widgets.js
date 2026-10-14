// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `ezviz`.
//
// The use case: a glance at the wall tablet when leaving or coming home —
// "what did the cameras see last, and is the house armed?". So the widget
// shows:
//   - the picture of the newest alarm of the cameras chosen in the widget
//     settings (several, a `multi_select` of the integration's devices), or
//     of every camera;
//   - a status: one row per camera (its last event, or online / offline),
//     then the arming mode;
//   - three buttons to set the arming mode (at home, away, sleep), the
//     current one marked by its icon (the `primary` style does not show in
//     dark mode, GladysAssistant/Gladys#3153). "At home" disarms: it asks
//     for a confirmation. No button when arming is not allowed.
// The arming mode belongs to the EZVIZ account, not to a camera (EZVIZ has
// one mode for the "default group" of the account): the widget says so, so a
// widget showing one camera does not look like it arms that camera only.
// The former single `camera` setting stays, read with the new `cameras` one:
// a setting key is permanent, and a saved box keeps its string value.
//
// Budget (8 components, ≤ 2 texts, one focal component, one status, ≤ 4
// buttons): one caption, one image, one status, three buttons. Images: keys
// `alarm-<hash of the alarm id>`, immutable, served by onWidgetGetImage from
// the pictures kept by the hub. Button action keys are distinct (the core
// drops a button whose action key is already used).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { cameraName } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ALARM_KINDS, ARM_MODES } from './ezviz/model.js';
import { ALARM_NAMES, ARM_MODE_NAMES, ERROR_TEXT, formatTime, pick } from './texts.js';

export const TEXT = {
  configure: {
    en: 'Enter the e-mail and password of your EZVIZ account in the configuration of the integration.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte EZVIZ dans la configuration de l’intégration.',
    de: 'Gib die E-Mail und das Passwort deines EZVIZ-Kontos in der Konfiguration der Integration ein.',
    es: 'Introduzca el correo y la contraseña de su cuenta EZVIZ en la configuración de la integración.',
  },
  unknown: {
    en: 'This camera is no longer in the EZVIZ account: choose another one in the widget settings.',
    fr: 'Cette caméra n’est plus dans le compte EZVIZ : choisissez-en une autre dans les réglages du widget.',
    de: 'Diese Kamera ist nicht mehr im EZVIZ-Konto: Wähle eine andere in den Widget-Einstellungen.',
    es: 'Esta cámara ya no está en la cuenta EZVIZ: elija otra en la configuración del widget.',
  },
  noAlarm: {
    en: 'No alarm in the EZVIZ cloud yet.',
    fr: 'Aucune alarme dans le cloud EZVIZ pour l’instant.',
    de: 'Noch kein Alarm in der EZVIZ-Cloud.',
    es: 'Ninguna alarma en la nube EZVIZ por ahora.',
  },
  lastEvent: {
    en: 'Last event',
    fr: 'Dernier événement',
    de: 'Letztes Ereignis',
    es: 'Último evento',
  },
  armMode: {
    en: 'EZVIZ account mode',
    fr: 'Mode du compte EZVIZ',
    de: 'Modus des EZVIZ-Kontos',
    es: 'Modo de la cuenta EZVIZ',
  },
  unknownMode: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  isOnline: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  isOffline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  armed: {
    en: 'EZVIZ account mode (all cameras):',
    fr: 'Mode du compte EZVIZ (toutes les caméras) :',
    de: 'Modus des EZVIZ-Kontos (alle Kameras):',
    es: 'Modo de la cuenta EZVIZ (todas las cámaras):',
  },
};

const ICONS = { home: 'home', away: 'shield', sleep: 'moon' };
const KIND_ICONS = {
  [ALARM_KINDS.MOTION]: 'activity',
  [ALARM_KINDS.PERSON]: 'user',
  [ALARM_KINDS.DOORBELL]: 'bell',
  [ALARM_KINDS.OTHER]: 'alert-triangle',
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The ids of the cameras chosen in the settings (several, or one with the former setting). */
function chosenIds(settings) {
  const ids = [...(Array.isArray(settings?.cameras) ? settings.cameras : []), settings?.camera];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id))];
}

/** The newest alarm of some cameras. */
function newestAlarm(view, cameras) {
  let newest = null;
  for (const camera of cameras) {
    const alarm = view.lastAlarms.get(camera.serial);
    if (alarm && (!newest || (alarm.at ?? 0) > (newest.at ?? 0))) {
      newest = alarm;
    }
  }
  return newest;
}

/** One status row per camera: its last event, else whether it is online. */
function cameraRow(view, camera, language) {
  const alarm = view.lastAlarms.get(camera.serial);
  const kinds = ALARM_NAMES[language] ?? ALARM_NAMES.en;
  if (alarm) {
    return {
      label: fit(cameraName(camera, language), 40),
      icon: KIND_ICONS[alarm.kind] ?? KIND_ICONS.other,
      value: fit(`${kinds[alarm.kind]} · ${formatTime(alarm.at, language, view.now)}`, 40),
      color: !camera.online
        ? WIDGET_COLORS.DANGER
        : alarm.kind === ALARM_KINDS.OTHER
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.INFO,
    };
  }
  return {
    label: fit(cameraName(camera, language), 40),
    icon: camera.online ? 'video' : 'video-off',
    value: t(camera.online ? TEXT.isOnline : TEXT.isOffline, language),
    color: camera.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  };
}

async function get(hub, { settings, language = 'en' }) {
  const view = hub.view();
  if (!view.configured) {
    return message(TEXT.configure, language);
  }
  const ids = chosenIds(settings);
  let shown = view.cameras;
  if (ids.length > 0) {
    shown = view.cameras.filter((camera) => ids.includes(view.cameraId(camera)));
    if (shown.length === 0) {
      return message(TEXT.unknown, language);
    }
  }
  const components = [];
  if (view.reachable === false && view.error) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(t(ERROR_TEXT[view.error.kind] ?? ERROR_TEXT.api, language), 80),
    });
  }

  const alarm = newestAlarm(view, shown);
  if (alarm?.imageKey) {
    components.push({
      type: 'image',
      key: alarm.imageKey,
      alt: t(TEXT.lastEvent, language),
      fit: 'contain',
    });
  } else if (!alarm) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.noAlarm, language) });
  }

  // The cameras, the one of the newest alarm first; the arming mode, which is
  // the mode of the whole EZVIZ account, last.
  const ordered = [...shown].sort(
    (a, b) => (view.lastAlarms.get(b.serial)?.at ?? 0) - (view.lastAlarms.get(a.serial)?.at ?? 0),
  );
  const items = ordered.slice(0, 8).map((camera) => cameraRow(view, camera, language));
  const modes = ARM_MODE_NAMES[language] ?? ARM_MODE_NAMES.en;
  items.push({
    label: t(TEXT.armMode, language),
    icon: view.armMode ? ICONS[view.armMode] : 'help-circle',
    value: view.armMode ? modes[view.armMode] : t(TEXT.unknownMode, language),
    color:
      view.armMode === 'home'
        ? WIDGET_COLORS.NEUTRAL
        : view.armMode
          ? WIDGET_COLORS.SUCCESS
          : WIDGET_COLORS.WARNING,
  });
  components.push({ type: 'status', items });

  if (view.allowArming && view.reachable !== false) {
    for (const mode of Object.keys(ARM_MODES)) {
      const current = view.armMode === mode;
      components.push({
        type: 'button',
        label: modes[mode],
        icon: current ? 'check-circle' : ICONS[mode],
        style: 'secondary',
        action: {
          key: `arm_${mode}`,
          params: { mode },
          // "At home" switches the detections off: asked before.
          ...(mode === 'home' && !current ? { confirm: true } : {}),
        },
      });
    }
  }
  // New alarms and commands nudge the widget (requestWidgetRefresh); the TTL is a net.
  return { ttl_seconds: 120, components };
}

/** A tap on an arming button. */
async function action(hub, { params }) {
  const mode = String(params?.mode ?? '');
  await hub.setArmMode(mode, 'Widget');
  const toast = {};
  for (const language of ['en', 'fr', 'de', 'es']) {
    toast[language] = `${TEXT.armed[language]} ${ARM_MODE_NAMES[language][mode]}`;
  }
  return toast;
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
