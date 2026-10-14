// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
//   - refresh_snapshot: a fresh picture of a camera, sent to Gladys, so the
//     next action ("send the camera image" in a message) sends what the
//     camera sees now;
//   - move_camera: one pan/tilt step of a motorized camera (START then STOP:
//     never a move left running);
//   - set_arm_mode: the arming mode of the account (at home, away, sleep), as
//     the EZVIZ app sets it — only when arming is allowed in the
//     configuration;
//   - set_camera_sleep: put a camera to sleep or wake it (its sleep mode,
//     else its privacy mode), for "I am home: indoor cameras asleep".
// Gladys applies the field defaults to scene actions; a failure throws, the
// scene logs it and carries on.
// -----------------------------------------------------------------------------

import { MOVES } from './devices.js';
import { ARM_MODES } from './ezviz/model.js';

// Options of the `direction` and `mode` fields: permanent once published.
export const DIRECTIONS = Object.values(MOVES);
export const MODES = Object.keys(ARM_MODES);
export const SLEEP_STATES = ['sleep', 'wake'];

export const SCENE_ACTIONS = {
  async refresh_snapshot(hub, { fields = {} }) {
    await hub.refreshSnapshot(fields.camera);
  },

  async move_camera(hub, { fields = {} }) {
    await hub.moveCamera(fields.camera, String(fields.direction ?? ''));
  },

  async set_arm_mode(hub, { fields = {} }) {
    await hub.setArmMode(String(fields.mode ?? ''), 'Scene action');
  },

  async set_camera_sleep(hub, { fields = {} }) {
    const state = String(fields.state ?? '');
    if (!SLEEP_STATES.includes(state)) {
      throw new Error(`Unknown state ${state}`);
    }
    await hub.setCameraSleep(fields.camera, state === 'sleep', 'Scene action');
  },
};
