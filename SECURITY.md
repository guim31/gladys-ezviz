# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes. In
particular:

- **Secrets**: the password of the EZVIZ account lives in the Gladys
  configuration of the integration (a `secret` field); the verification codes
  of the cameras, there too (`secret` field) or in `/data` when saved with the
  "Set a camera verification code" action. The password is sent only to the EZVIZ cloud (hosts under
  `ezvizlife.com`, `ezvizru.com` or `ezviz.com`, HTTPS), as the MD5 digest the
  EZVIZ apps send; the codes are never sent anywhere (they decrypt pictures
  locally and build the RTSP address shown on request). None of them is
  written to the logs, and the password never to `/data`.
- **`/data`**: one file, `ezviz-state.json`, mode 0600: the session of the
  account (session and refresh ids, API domain, EZVIZ user id) keyed by a hash
  of the account and server, a random terminal id, the serials of the cameras
  seen ringing, and the verification codes saved by the action, by serial.
  Whoever reads this file can use the EZVIZ session until it expires or the
  password changes, and decrypt the pictures of those cameras.
- **Network**: the integration talks only to the EZVIZ cloud over HTTPS (API
  and picture downloads, `https://` addresses only), never to the cameras.
- **Camera images** stay in memory (the last ones, for the widget) and go to
  Gladys only. RTSP addresses contain the verification code of a camera: they
  are shown to the user on request and never logged.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the EZVIZ cloud, apps, firmware and devices (report those to EZVIZ).
