# EZVIZ for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for **EZVIZ**
cameras and doorbells, through the **EZVIZ cloud** (the one the EZVIZ app
uses): alarm pictures, motion and person detections, doorbell rings, the
arming mode of the account, privacy mode, motion detection, floodlight, siren,
pan and tilt, battery, Wi-Fi and SD card.

> **Developed without the hardware: feedback welcome.** No EZVIZ camera nor
> EZVIZ account was available to write this integration: it was built from
> the work of the Home Assistant `ezviz` integration and of the pyEzviz /
> pyEzvizApi library, and is covered by tests against a fake EZVIZ cloud
> built from their published fixtures. Please report what works and what
> does not in the [issues](https://github.com/guim31/gladys-ezviz/issues).
>
> This project is **not affiliated with EZVIZ or Hikvision**. EZVIZ is a
> trademark of Hangzhou EZVIZ Network Co., Ltd.

## Features

- **Cameras and doorbells** (one Gladys device each): image (the picture of
  each alarm, then fresh captures on a timer, decrypted with the
  verification code when the camera encrypts its pictures), pan and tilt
  arrows on motorized cameras, motion, doorbell ring, last event ("Person ·
  18:32"), online, motion detection on/off, privacy mode, sleep mode,
  floodlight, siren (opt-in), battery, Wi-Fi signal, SD card state and size.
- **The account**: its arming mode (at home, away, sleep), as on the home page
  of the EZVIZ app — one mode for the whole account, read-only if you prefer.
- **Scene triggers**: _Detection by an EZVIZ camera_ (filter by camera and by
  motion, person or other alarm) and _Someone rang an EZVIZ doorbell_. The
  camera image is the alarm picture when the scene starts.
- **Scene actions**: _Take a fresh EZVIZ picture_, _Turn an EZVIZ camera_
  (one pan/tilt step), _Set the EZVIZ arming mode_, _Put an EZVIZ camera to
  sleep or wake it_.
- **Dashboard widget** _EZVIZ_: the picture of the newest alarm of one,
  several or all cameras, one line per camera, buttons to switch the EZVIZ
  account mode, and a sleep / wake button when it shows one camera.
- **Configuration actions**: _Test the connection_, _Enter the verification
  code_ (two-step verification), _Set a camera verification code_ (kept in
  `/data`, checked on the last picture), _Show the RTSP address_ (for the
  "RTSP camera" integration of Gladys).
- Four languages: English, French, German, Spanish.

## Requirements

- An EZVIZ account (the login of the EZVIZ app) and, optionally, the
  verification code printed on each camera.
- Gladys Assistant **5.1.0 or later**, with Internet access.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-ezviz`
   (or install **EZVIZ** from the catalog once it is listed).
2. In **Configuration**, enter the e-mail (or phone number) and the password
   of the EZVIZ account, save, then click **Test the connection**. If EZVIZ
   sends a verification code, enter it with **Enter the verification code**.
3. Open the **Discover** tab and add the cameras and the "EZVIZ account".

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **API**: the private API of the EZVIZ apps, as pyEzvizApi documents it (the
  library of the Home Assistant integration): `POST /v3/users/login/v5`
  (MD5 digest of the password, region redirect `1100`, verification code
  `6002`), session renewal `PUT /v3/apigateway/login`, device list
  `GET /v3/userdevices/v1/resources/pagelist`, alarms
  `GET /v3/unifiedmsg/list`, arming mode `…/group/defenceMode` and
  `…/group/switchDefenceMode`, switches (privacy 7, sleep 21, floodlight 303),
  motion detection `changeDefenceStatusReq`, siren `sendAlarm`, pan/tilt
  `ptzControl` (always START then STOP), capture `…/capture`, picture key
  `/api/device/query/encryptkey`. No dependency for HTTP: the `fetch` of
  Node.js.
- **Session**: the session and a terminal id drawn once are kept in
  `/data/ezviz-state.json` (mode 0600), so a restart neither logs in again
  nor asks for a new verification code. A refused password or a locked
  account stops the automatic logins until the user acts (EZVIZ locks an
  account after repeated failures).
- **Refresh**: the devices are published with `should_poll: false` and the
  container reads the cloud on its own timers (GladysAssistant/Gladys#3198):
  the alarms of every camera every 30 s by default (15 to 120 s), the device
  list and the arming mode every 5 minutes and after each command, a capture
  of the mains-powered cameras every 5 minutes by default (1 to 60, or never)
  — never a battery camera. About 3,500 requests a day plus 288 per
  mains-powered camera with the defaults, the pace of Home Assistant.
- **Images in Gladys 5.2.1**: the camera box of the dashboard shows the last
  image the integration published (`publishCameraImage`) and never asks for a
  new one; only the "send camera image" and "ask the AI" scene actions call
  `onGetImage`, which sends the alarm picture of the last 30 seconds, else a
  fresh capture. So the dashboard is as fresh as the capture timer; live video
  goes through the RTSP address.
- **Alarms**: each new alarm pulses the motion (one minute) or ring feature,
  updates the last event, downloads its picture, decrypts it if needed
  (`hikencodepicture`, AES-128-CBC keyed by the verification code), sends it
  as the camera image, then fires the scene trigger. Its kind comes from the
  EZVIZ type code (10000 PIR, 10002 motion, 10016 doorbell) or from its
  English title.
- **Images**: Gladys takes 150 KB per camera image: a larger picture is
  decoded at a reduced size and re-encoded in a worker thread, in pure
  JavaScript (`src/jpeg-scaled.js`, [jpeg-js](https://github.com/eugeneware/jpeg-js)),
  as in guim31/gladys-unifi-protect.
- **States**: `publishChangedStates`, only the changes, plus a heartbeat every
  6 hours; only for the devices added to Gladys.
- **Logs**: the lifecycle only at info level; a repeated failure is logged
  once, and once when it clears; `LOG_LEVEL=debug` shows each alarm with its
  EZVIZ type. Never the password, the e-mail, a session, a code, a picture or
  stream address.
- **Probe**: `node scripts/probe.mjs` checks against the real cloud that a
  made-up account is refused cleanly; with `EZVIZ_USERNAME` and
  `EZVIZ_PASSWORD` (and `EZVIZ_CODE`), it prints a read-only summary of an
  account (capabilities, arming mode, alarm types), serials masked.

## What could not be checked

No EZVIZ camera, no EZVIZ account and no Gladys instance were available, and
the EZVIZ cloud was not reachable from the development environment:

- the answers of `unifiedmsg/list` and of `capture` (no real one is published:
  the shapes come from pyEzvizApi's code), and the alarm type codes and
  titles of each model (person detection in particular);
- the client name `Gladys` sent at login (`cuName`), where pyEzviz sends
  `Hassio`;
- the region redirect and the two-step verification flow on a real account;
- the size of real alarm pictures, and the decryption of a real encrypted
  picture (checked against pictures encrypted the same way by the tests);
- the dashboard rendering of the pan/tilt arrows (`camera/move`).

## Limitations

- Cloud only, through an unofficial API EZVIZ may change.
- No continuous video, two-way audio or recordings (RTSP address on request).
- Cameras and doorbells only: no EZVIZ plugs, bulbs, locks, alarm hubs or
  NVR base stations.
- One arming mode for the whole account, one account per Gladys.
- The free space of the SD card is not reported by the cloud.

## Development

```bash
npm install
npm test                 # node --test, against the SDK's fake Gladys and a fake EZVIZ cloud
npm run lint
npm run format:check
node scripts/probe.mjs   # real cloud, read-only (see above)
```

## Credits

- [pyEzviz](https://github.com/BaQs/pyEzviz) and
  [pyEzvizApi](https://github.com/RenierM26/pyEzvizApi) (Apache-2.0), by
  BaQs, Renier Moorcroft and contributors: the endpoints, the login flow, the
  picture encryption, and the anonymized device list used as test fixture.
- The [Home Assistant `ezviz` integration](https://www.home-assistant.io/integrations/ezviz)
  (Apache-2.0): which capabilities to expose and how to read them.
- [guim31/gladys-unifi-protect](https://github.com/guim31/gladys-unifi-protect):
  the image pipeline and the structure of this integration.

## License

[Apache-2.0](LICENSE).
