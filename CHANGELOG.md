# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Live view in Gladys: a camera whose local address and verification code are
  known gives its local RTSP stream to Gladys, and the live button of the
  dashboard camera box plays it, without the cloud. Enable RTSP on the camera
  in the EZVIZ app first.

## [1.2.0] - 2026-10-14

### Added

- **Sleep mode** switch on the cameras that announce it (EZVIZ switch 21 with
  the SupportSleep capability, as Home Assistant reads them): no video and no
  detection while asleep; the capture timer skips a sleeping camera.
- Scene action **Put an EZVIZ camera to sleep or wake it**: its sleep mode,
  else its privacy mode (lens hidden), for "I am home: indoor cameras asleep".
- Widget: when it shows one camera that can sleep, a **Sleep** / **Wake up**
  button, and the camera's line reads "Asleep".

## [1.1.1] - 2026-10-14

### Fixed

- The widget showed the EZVIZ names of the cameras ("C6N(…)"): it now shows
  the names they have in Gladys.
- "EZVIZ account", offered by Gladys in the camera list of the widget, is
  ignored (it is not a camera); chosen alone, the widget shows every camera.
  The setting says so: Gladys 5.2.1 cannot leave it out of the list.

## [1.1.0] - 2026-10-14

### Fixed

- Two verification codes typed without their serial numbers ("CODE1,CODE2"):
  the first one was used for every camera. They are now ignored, and the
  status of the integration lists the cameras with their serial numbers.
- The documentation promised a fresh image when the dashboard opens: in
  Gladys 5.2.1 the camera box shows the last image the integration sent, so
  its freshness is the capture interval. Documented, with the RTSP address
  for live video.
- "Send the camera image" right after an alarm now sends the alarm picture
  (an image of the last 30 seconds), not a capture taken a few seconds later.

### Added

- "Set a camera verification code" configuration action: pick a camera, type
  its code; kept by the integration and checked on its last picture.
- The widget can show several cameras (new "Cameras" setting; the former
  "Camera" setting keeps working).
- "Every minute" option for the camera images.

### Changed

- The widget and the documentation say that the arming mode is the mode of
  the whole EZVIZ account: its buttons act on every camera.
- Camera images every 5 minutes by default (15 before), for a fresher
  dashboard.

## [1.0.1] - 2026-10-14

### Added

- EZVIZ cameras and doorbells in Gladys, through the EZVIZ cloud: one device
  per camera with its image (alarm pictures, captures on a timer and on
  demand, decrypted with the camera verification code), pan and tilt, motion,
  doorbell ring, last event, online, motion detection, privacy mode,
  floodlight, siren (off unless allowed), battery, Wi-Fi signal and SD card.
- The arming mode of the EZVIZ account (at home, away, sleep), read-only if
  arming from Gladys is not allowed.
- Login with two-step verification through the "Enter the verification code"
  action; the session is kept across restarts, and a refused password is not
  retried automatically.
- Scene triggers "Detection by an EZVIZ camera" (motion, person, other) and
  "Someone rang an EZVIZ doorbell"; scene actions "Take a fresh EZVIZ
  picture", "Turn an EZVIZ camera" and "Set the EZVIZ arming mode".
- The "EZVIZ" dashboard widget: last alarm picture, last event, arming
  buttons.
- "Test the connection" and "Show the RTSP address" configuration actions.
- Documentation in English, French, German and Spanish.
  [Unreleased]: https://github.com/guim31/gladys-ezviz/commits/main

[Unreleased]: https://github.com/guim31/gladys-ezviz/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/guim31/gladys-ezviz/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/guim31/gladys-ezviz/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/guim31/gladys-ezviz/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/guim31/gladys-ezviz/releases/tag/v1.0.1
