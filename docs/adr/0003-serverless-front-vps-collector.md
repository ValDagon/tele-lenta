# Serverless hosts the product surface; a VPS collects

Status: accepted

Telegram Serverless has no scheduled invocation and no long-running process, while the
collector must poll public embed pages every few minutes. The Mini App, endpoints, and the
product bot fit Serverless exactly; the collector and its database do not. We run the
collector on a small VPS and keep the product surface on Serverless.

## Consequences

- The VPS owns listings, clusters, sources, and saved searches. The Mini App endpoint is a
  BFF: it verifies `initData` and proxies to the VPS with a shared secret.
- The product bot is only the Mini App entry point and the notification sender; it is never
  added to a source chat.
- Digests are sent by the VPS cron through the Bot API.
- Two runtimes to deploy and monitor, but no cron emulation on Serverless.
- If Cloudflare Workers + Queues prove reliable against Telegram, the collector can move
  there later; the BFF contract stays the same.
