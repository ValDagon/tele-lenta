# Security Policy

## Supported versions

This project is a deployment blueprint rather than a versioned library: a fork
runs the code it checked out. Security fixes land on `main` and are never
backported to older commits.

| Version | Supported |
| ------- | --------- |
| `main` (latest commit) | :white_check_mark: |
| any older commit | :x: |

## Reporting a vulnerability

> [!CAUTION]
> **Do not open a public issue for a vulnerability or a leaked credential.**
> A public report puts every deployment of this code at risk.

Use GitHub's private vulnerability reporting:

1. Open the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe the impact, the affected paths, and the reproduction steps.

Direct link:
<https://github.com/ValDagon/tele-lenta/security/advisories/new>

If private reporting is unavailable on your fork, open an issue that says only
"private security contact requested" — with no details — and a maintainer will
open a private channel.

### What to include

1. The vulnerability and its impact. In this project the interesting classes are
   `initData` verification bypass, a signature or shared-secret leak, SSRF or
   request smuggling in the collector, SQL injection in `vps/src/store/`, and
   any path that exposes another Telegram user's data.
2. A minimal reproduction: the request, the code path, or a failing test.
3. The commit you tested and the deployment shape (VPS collector, Telegram
   Serverless BFF, or Mini App).

### What to expect

- **Initial acknowledgement:** within 48 hours.
- **Triage and impact assessment:** within 5 business days.
- **Fix and coordinated disclosure:** as soon as a patch is ready; the advisory
  is published after the fix lands on `main`.

## Scope

In scope: the code in this repository.

Out of scope: the Telegram platform itself, the public chats this collector
reads, and any deployment whose operator chose a weak shared secret, exposed the
API beyond loopback, or committed a real `.env` file.
