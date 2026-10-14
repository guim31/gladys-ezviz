# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
