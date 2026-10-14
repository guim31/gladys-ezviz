// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the reports of the Configuration actions, scene
// action errors, trigger variables, the "last event" feature. Four languages,
// the four of the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './ezviz/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object rendered by a function of the language. */
export const localized = (render) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, render(language)]));

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noAccount: {
    en: 'Enter the e-mail and password of your EZVIZ account in the configuration.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte EZVIZ dans la configuration.',
    de: 'Gib die E-Mail und das Passwort deines EZVIZ-Kontos in der Konfiguration ein.',
    es: 'Introduzca el correo y la contraseña de su cuenta EZVIZ en la configuración.',
  },
  invalidServer: {
    en: 'API server not understood: leave the field empty, or e.g. apiieu.ezvizlife.com',
    fr: 'Serveur d’API incompris : laissez le champ vide, ou ex. apiieu.ezvizlife.com',
    de: 'API-Server nicht verstanden: Lass das Feld leer, oder z. B. apiieu.ezvizlife.com',
    es: 'Servidor de API no válido: deje el campo vacío, o p. ej. apiieu.ezvizlife.com',
  },
  waitingCode: {
    en: 'EZVIZ sent a verification code: enter it with the "Enter the verification code" action.',
    fr: 'EZVIZ a envoyé un code de vérification : saisissez-le avec l’action « Saisir le code de vérification ».',
    de: 'EZVIZ hat einen Bestätigungscode gesendet: Gib ihn mit der Aktion „Bestätigungscode eingeben“ ein.',
    es: 'EZVIZ ha enviado un código de verificación: introdúzcalo con la acción «Introducir el código de verificación».',
  },
};

// One explanation per error kind (src/ezviz/client.js), shown in the
// connection status and in the reports.
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'The EZVIZ cloud does not answer: check the Internet access of Gladys. Retrying.',
    fr: 'Le cloud EZVIZ ne répond pas : vérifiez l’accès à Internet de Gladys. Nouvel essai en cours.',
    de: 'Die EZVIZ-Cloud antwortet nicht: Prüfe den Internetzugang von Gladys. Neuer Versuch läuft.',
    es: 'La nube EZVIZ no responde: compruebe el acceso a Internet de Gladys. Reintentando.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'EZVIZ refused the e-mail or the password: correct them and save.',
    fr: 'EZVIZ a refusé l’e-mail ou le mot de passe : corrigez-les puis enregistrez.',
    de: 'EZVIZ hat die E-Mail oder das Passwort abgelehnt: Korrigiere sie und speichere.',
    es: 'EZVIZ ha rechazado el correo o la contraseña: corríjalos y guarde.',
  },
  [ERROR_KINDS.LOCKED]: {
    en: 'EZVIZ locked the account after too many attempts: unlock it in the EZVIZ app, then test the connection.',
    fr: 'EZVIZ a bloqué le compte après trop d’essais : débloquez-le dans l’app EZVIZ, puis testez la connexion.',
    de: 'EZVIZ hat das Konto nach zu vielen Versuchen gesperrt: Entsperre es in der EZVIZ-App und teste dann die Verbindung.',
    es: 'EZVIZ ha bloqueado la cuenta tras demasiados intentos: desbloquéela en la app EZVIZ y pruebe la conexión.',
  },
  [ERROR_KINDS.MFA_REQUIRED]: CONNECTION_TEXT.waitingCode,
  [ERROR_KINDS.MFA_INVALID]: {
    en: 'Verification code refused or expired: run the action with an empty code to get a new one.',
    fr: 'Code de vérification refusé ou expiré : lancez l’action avec un code vide pour en recevoir un nouveau.',
    de: 'Bestätigungscode abgelehnt oder abgelaufen: Starte die Aktion mit leerem Code, um einen neuen zu erhalten.',
    es: 'Código de verificación rechazado o caducado: ejecute la acción con el código vacío para recibir otro.',
  },
  [ERROR_KINDS.SESSION]: {
    en: 'The EZVIZ session expired: test the connection to log in again.',
    fr: 'La session EZVIZ a expiré : testez la connexion pour vous reconnecter.',
    de: 'Die EZVIZ-Sitzung ist abgelaufen: Teste die Verbindung, um dich erneut anzumelden.',
    es: 'La sesión EZVIZ ha caducado: pruebe la conexión para volver a iniciar sesión.',
  },
  [ERROR_KINDS.OFFLINE]: {
    en: 'The camera does not answer the EZVIZ cloud: check that it is online.',
    fr: 'La caméra ne répond pas au cloud EZVIZ : vérifiez qu’elle est en ligne.',
    de: 'Die Kamera antwortet der EZVIZ-Cloud nicht: Prüfe, ob sie online ist.',
    es: 'La cámara no responde a la nube EZVIZ: compruebe que esté en línea.',
  },
  [ERROR_KINDS.API]: {
    en: 'The EZVIZ cloud refused the request: see the integration logs.',
    fr: 'Le cloud EZVIZ a refusé la requête : consultez les logs de l’intégration.',
    de: 'Die EZVIZ-Cloud hat die Anfrage abgelehnt: Sieh dir die Protokolle der Integration an.',
    es: 'La nube EZVIZ ha rechazado la petición: consulte los registros de la integración.',
  },
};

// "Test the connection": a short report, in the language of each user.
export const REPORT_TEXT = {
  en: {
    ok: (cameras, server) => `Connected to the EZVIZ cloud (${server}): ${cameras} camera(s).`,
    encrypted: (count) =>
      `${count} camera(s) encrypt their pictures without a verification code in the configuration.`,
  },
  fr: {
    ok: (cameras, server) => `Connecté au cloud EZVIZ (${server}) : ${cameras} caméra(s).`,
    encrypted: (count) =>
      `${count} caméra(s) chiffrent leurs images sans code de vérification dans la configuration.`,
  },
  de: {
    ok: (cameras, server) => `Mit der EZVIZ-Cloud verbunden (${server}): ${cameras} Kamera(s).`,
    encrypted: (count) =>
      `${count} Kamera(s) verschlüsseln ihre Bilder ohne Bestätigungscode in der Konfiguration.`,
  },
  es: {
    ok: (cameras, server) => `Conectado a la nube EZVIZ (${server}): ${cameras} cámara(s).`,
    encrypted: (count) =>
      `${count} cámara(s) cifran sus imágenes sin código de verificación en la configuración.`,
  },
};

// The verification codes of the cameras: the "camera code" action, and the
// codes of the configuration that cannot be matched to a camera. `list` is
// "Name (SERIAL), Name (SERIAL)".
export const CODE_TEXT = {
  en: {
    saved: (name) => `Verification code saved for ${name}.`,
    checked: (name) => `Verification code saved for ${name}: it opens its last picture.`,
    wrong: (name) =>
      `Code saved for ${name}, but it does not open its last picture: check the label of this camera.`,
    removed: (name) => `Verification code removed for ${name}.`,
    invalid: () =>
      'A verification code is made of letters and digits (6 capital letters on most cameras).',
    ambiguous: (list) =>
      `Several verification codes without a serial number are ignored. Use the "Set a camera verification code" action, or write SERIAL:CODE. Your cameras: ${list}.`,
  },
  fr: {
    saved: (name) => `Code de vérification enregistré pour ${name}.`,
    checked: (name) => `Code de vérification enregistré pour ${name} : il ouvre sa dernière image.`,
    wrong: (name) =>
      `Code enregistré pour ${name}, mais il n’ouvre pas sa dernière image : vérifiez l’étiquette de cette caméra.`,
    removed: (name) => `Code de vérification retiré pour ${name}.`,
    invalid: () =>
      'Un code de vérification est fait de lettres et de chiffres (6 majuscules sur la plupart des caméras).',
    ambiguous: (list) =>
      `Plusieurs codes de vérification sans numéro de série sont ignorés. Utilisez l’action « Code de vérification d’une caméra », ou écrivez SÉRIE:CODE. Vos caméras : ${list}.`,
  },
  de: {
    saved: (name) => `Bestätigungscode für ${name} gespeichert.`,
    checked: (name) => `Bestätigungscode für ${name} gespeichert: Er öffnet ihr letztes Bild.`,
    wrong: (name) =>
      `Code für ${name} gespeichert, aber er öffnet ihr letztes Bild nicht: Prüfe das Etikett dieser Kamera.`,
    removed: (name) => `Bestätigungscode für ${name} entfernt.`,
    invalid: () =>
      'Ein Bestätigungscode besteht aus Buchstaben und Ziffern (6 Großbuchstaben bei den meisten Kameras).',
    ambiguous: (list) =>
      `Mehrere Bestätigungscodes ohne Seriennummer werden ignoriert. Nutze die Aktion „Bestätigungscode einer Kamera“ oder schreibe SERIE:CODE. Deine Kameras: ${list}.`,
  },
  es: {
    saved: (name) => `Código de verificación guardado para ${name}.`,
    checked: (name) => `Código de verificación guardado para ${name}: abre su última imagen.`,
    wrong: (name) =>
      `Código guardado para ${name}, pero no abre su última imagen: compruebe la etiqueta de esta cámara.`,
    removed: (name) => `Código de verificación eliminado para ${name}.`,
    invalid: () =>
      'Un código de verificación se compone de letras y cifras (6 mayúsculas en la mayoría de las cámaras).',
    ambiguous: (list) =>
      `Se ignoran varios códigos de verificación sin número de serie. Use la acción «Código de verificación de una cámara», o escriba SERIE:CÓDIGO. Sus cámaras: ${list}.`,
  },
};

export const ACTION_TEXT = {
  notConfigured: CONNECTION_TEXT.noAccount,
  notConnected: {
    en: 'Not connected to the EZVIZ cloud yet: test the connection first.',
    fr: 'Pas encore connecté au cloud EZVIZ : testez d’abord la connexion.',
    de: 'Noch nicht mit der EZVIZ-Cloud verbunden: Teste zuerst die Verbindung.',
    es: 'Aún no conectado a la nube EZVIZ: pruebe primero la conexión.',
  },
  pickCamera: {
    en: 'Choose a camera.',
    fr: 'Choisissez une caméra.',
    de: 'Wähle eine Kamera.',
    es: 'Elija una cámara.',
  },
  unknownCamera: {
    en: 'This camera is no longer in the EZVIZ account.',
    fr: 'Cette caméra n’est plus dans le compte EZVIZ.',
    de: 'Diese Kamera ist nicht mehr im EZVIZ-Konto.',
    es: 'Esta cámara ya no está en la cuenta EZVIZ.',
  },
  snapshotFailed: {
    en: 'No picture from the camera: it may be asleep or offline.',
    fr: 'Pas d’image de la caméra : elle est peut-être en veille ou hors ligne.',
    de: 'Kein Bild von der Kamera: Vielleicht schläft sie oder ist offline.',
    es: 'Sin imagen de la cámara: puede estar en reposo o sin conexión.',
  },
  noSleep: {
    en: 'This camera has neither a sleep mode nor a privacy mode.',
    fr: 'Cette caméra n’a ni mode veille ni mode confidentialité.',
    de: 'Diese Kamera hat weder Ruhemodus noch Privatsphäre-Modus.',
    es: 'Esta cámara no tiene modo reposo ni modo privacidad.',
  },
  notPtz: {
    en: 'This camera cannot pan or tilt.',
    fr: 'Cette caméra ne peut pas pivoter.',
    de: 'Diese Kamera kann nicht schwenken oder neigen.',
    es: 'Esta cámara no puede girar ni inclinarse.',
  },
  armingDisabled: {
    en: 'Arming from Gladys is disabled in the configuration.',
    fr: 'L’armement depuis Gladys est désactivé dans la configuration.',
    de: 'Das Scharfschalten über Gladys ist in der Konfiguration deaktiviert.',
    es: 'El armado desde Gladys está desactivado en la configuración.',
  },
  codeSent: {
    en: 'EZVIZ is sending a new verification code by e-mail or SMS: run this action again with it.',
    fr: 'EZVIZ envoie un nouveau code de vérification par e-mail ou SMS : relancez cette action avec ce code.',
    de: 'EZVIZ sendet einen neuen Bestätigungscode per E-Mail oder SMS: Starte diese Aktion damit erneut.',
    es: 'EZVIZ envía un nuevo código de verificación por correo o SMS: vuelva a ejecutar esta acción con él.',
  },
  codeAccepted: {
    en: 'Code accepted: Gladys is connected to the EZVIZ account.',
    fr: 'Code accepté : Gladys est connecté au compte EZVIZ.',
    de: 'Code akzeptiert: Gladys ist mit dem EZVIZ-Konto verbunden.',
    es: 'Código aceptado: Gladys está conectado a la cuenta EZVIZ.',
  },
  noCodeNeeded: {
    en: 'No verification code is needed: the account is connected.',
    fr: 'Aucun code de vérification n’est nécessaire : le compte est connecté.',
    de: 'Kein Bestätigungscode nötig: Das Konto ist verbunden.',
    es: 'No se necesita ningún código de verificación: la cuenta está conectada.',
  },
  noLocalAddress: {
    en: 'EZVIZ does not know the local address of this camera.',
    fr: 'EZVIZ ne connaît pas l’adresse locale de cette caméra.',
    de: 'EZVIZ kennt die lokale Adresse dieser Kamera nicht.',
    es: 'EZVIZ no conoce la dirección local de esta cámara.',
  },
  stream: {
    en: 'RTSP address (enable RTSP in the EZVIZ app first):',
    fr: 'Adresse RTSP (activez d’abord RTSP dans l’app EZVIZ) :',
    de: 'RTSP-Adresse (aktiviere zuerst RTSP in der EZVIZ-App):',
    es: 'Dirección RTSP (active antes RTSP en la app EZVIZ):',
  },
  streamNoCode: {
    en: 'Save the verification code of this camera first, with the "Set a camera verification code" action.',
    fr: 'Enregistrez d’abord le code de vérification de cette caméra, avec l’action « Code de vérification d’une caméra ».',
    de: 'Speichere zuerst den Bestätigungscode dieser Kamera, mit der Aktion „Bestätigungscode einer Kamera“.',
    es: 'Guarde primero el código de verificación de esta cámara, con la acción «Código de verificación de una cámara».',
  },
};

// Kinds of alarm (src/ezviz/model.js ALARM_KINDS), as Gladys shows them.
export const ALARM_NAMES = {
  en: { motion: 'Motion', person: 'Person', doorbell: 'Doorbell', other: 'Alarm' },
  fr: { motion: 'Mouvement', person: 'Personne', doorbell: 'Sonnette', other: 'Alarme' },
  de: { motion: 'Bewegung', person: 'Person', doorbell: 'Türklingel', other: 'Alarm' },
  es: { motion: 'Movimiento', person: 'Persona', doorbell: 'Timbre', other: 'Alarma' },
};

// Arming modes of the account (src/ezviz/model.js ARM_MODES).
export const ARM_MODE_NAMES = {
  en: { home: 'At home', away: 'Away', sleep: 'Sleep' },
  fr: { home: 'Présent', away: 'Absent', sleep: 'Sommeil' },
  de: { home: 'Zuhause', away: 'Abwesend', sleep: 'Schlafen' },
  es: { home: 'En casa', away: 'Ausente', sleep: 'Noche' },
};

// State of the SD card (src/ezviz/model.js sdCard).
export const SD_STATE_NAMES = {
  en: {
    normal: 'Normal',
    absent: 'No card',
    error: 'Error',
    unformatted: 'Not formatted',
    formatting: 'Formatting',
  },
  fr: {
    normal: 'Normale',
    absent: 'Pas de carte',
    error: 'Erreur',
    unformatted: 'Non formatée',
    formatting: 'Formatage en cours',
  },
  de: {
    normal: 'Normal',
    absent: 'Keine Karte',
    error: 'Fehler',
    unformatted: 'Nicht formatiert',
    formatting: 'Wird formatiert',
  },
  es: {
    normal: 'Normal',
    absent: 'Sin tarjeta',
    error: 'Error',
    unformatted: 'Sin formatear',
    formatting: 'Formateando',
  },
};

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/**
 * "14/10 18:32" in the time zone of Gladys (the supervisor sets TZ), or
 * "18:32" for today.
 */
export function formatTime(at, language, now = Date.now()) {
  const locale = LOCALES[language] ?? LOCALES.en;
  const date = new Date(at);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  const day = (value) =>
    new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(value));
  return day(at) === day(now) ? time : `${day(at)} ${time}`;
}

/** "Person · 18:32": the text of the "last event" feature. */
export function eventText(alarm, language, now) {
  const names = ALARM_NAMES[language] ?? ALARM_NAMES.en;
  return `${names[alarm.kind] ?? names.other} · ${formatTime(alarm.at, language, now)}`;
}
