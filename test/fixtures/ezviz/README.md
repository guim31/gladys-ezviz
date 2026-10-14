# EZVIZ fixtures

- `pagelist.json`: five devices of the real, anonymized answer of
  `GET /v3/userdevices/v1/resources/pagelist` published in the tests of
  [pyEzvizApi](https://github.com/RenierM26/pyEzvizApi)
  (`tests/fixtures/page_list_response.json`, Apache-2.0): an LC1C floodlight
  camera, a C6CN pan/tilt camera with privacy mode and SD card, an EB3 battery
  camera (asleep), an H9c pan/tilt camera, a Husky Air (offline). Only the
  sections the integration reads are kept (`deviceInfos`, `STATUS`, `SWITCH`,
  `WIFI`, `CONNECTION`, `resourceInfos`), the serials renamed `EZFAKE…`, the
  names and MAC addresses invented; the addresses were already in
  192.0.2.0/24. The source has no doorbell: `EZFAKE021` is the C1C camera of
  the same file with the category of a doorbell (`BDoorBell`, `DB1C`).
- `alarms.json`: an answer of `GET /v3/unifiedmsg/list` written from the
  fields pyEzvizApi reads (`msgId`, `deviceSerial`, `time`, `timeStr`,
  `title`, `subType`, `ext.alarmType`, `ext.pics`) — no real answer of this
  endpoint is published. The alarm types are the ones of the EZVIZ open
  platform (10002 motion detection, 10016 smart doorbell); the titles are
  guesses of what the cloud writes in English.
