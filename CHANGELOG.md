# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.10.0 — 2026-05-20

### Changed

- **BREAKING:** advertise Gateway protocol v4 (`minProtocol`/`maxProtocol` = 4) in the connect frame. OC 2026.5.12 raised the minimum required client protocol from 3 to 4 (PR #80725, "require v4 clients and stream explicit `deltaText`/`replace` frames"). Gateways at 2026.5.12+ close v3 clients with code 1002 (`protocol mismatch ... min=3 max=3 expected=4 probeMin=4`) before the handshake completes. This release moves openclaw-node to v4 so it can connect to current Gateway releases.

### Notes

- Wire-level chat streaming compatibility is unchanged: OC 2026.5.18 still broadcasts the legacy `event: "agent"` payload (`stream: "assistant"`, `data.delta` / `data.text`) alongside the new `event: "chat"` v4 payload, so the existing assistant-text chunk handler keeps working.
- This release is **not** compatible with OC < 2026.5.12 (older Gateways validate `min`/`max` against PROTOCOL_VERSION = 3 and will reject v4 clients with the same mismatch error in the opposite direction). Stay on `openclaw-node@0.9.0` if you need to keep talking to OC ≤ 2026.5.7.

## 0.9.0 — 2026-05-11

### Added

- `ChatOptions.provider` / `ChatOptions.model` overrides forwarded to the Gateway's `agent` RPC. When set together, the Gateway's vision-capability check resolves against the explicit pair instead of falling back to its default model. Set both fields to work around the Gateway issue where `resolveSessionModelRef(cfg, entry, undefined)` discards `agentId` inside the `agent` RPC handler, which makes image attachments fail with `UnsupportedAttachmentError: active model does not accept image inputs` even on vision-capable per-agent models.

### Notes

- Backwards-compatible: omitting both fields preserves the existing behavior.
- Forward-compatible with a future Gateway-side fix that honours `agentId` directly.

## 0.8.0 — 2026-05-05

### Added

- `pairingRequired` event surfaces OC 4.29+ pairing-required close reasons (close code 1008, reason `pairing required: <reason> (requestId: <id>)`). Consumers can drive an external approval flow (e.g. via `openclaw devices approve <requestId>` from inside the gateway container) and rely on auto-reconnect to recover.
- `parsePairingRequiredReason()` exported helper for parsing close-reason strings.
- `PairingRequiredEvent` type exported from package root.
- `pairingRequired` added to `ClientEventMap` (type-level documentation for `.on()` consumers).

### Notes

- No behavioral change for already-paired devices or for setups that approve pairings out-of-band.
- This event surfaces the condition that previously caused infinite reconnect loops with no diagnostic.

## [0.7.0] - 2026-04-28

### Removed

- **BREAKING:** `continueLastTurn({ sessionKey })` is gone. The method was designed to send an agent request without a `message` field so the Gateway would re-run from existing session history, but OpenClaw's `AgentParamsSchema` requires `message: NonEmptyString` — so the call was rejected by every recent gateway version. The supported pattern for retry is to resend the user's last message via `chat()`; that's what the gateway's protocol was always designed for.

## [0.6.0] - 2026-04-28

### Added

- `agent_start` and `agent_end` chunk types on `ChatChunk` — emitted on lifecycle phase transitions so consumers can render turn boundaries.
- Lifecycle errors are now surfaced as `{ type: "error" }` chunks, deduped against res-error to avoid double-reporting.

## [0.5.0] - 2026-04-23

### Added

- `clientMessageId` option on `chat()` — when provided, yields a `userMessagePersisted` chunk after the Gateway acknowledges receipt of the user message (before the first assistant chunk). Useful for delivery-status tracking.
- `continueLastTurn({ sessionKey })` method — re-triggers the assistant response for the last user message in the session without appending a new user message. Useful for retry flows.

### Fixed

- All test files now use isolated `tmpDir` for device identity (previously relied on `~/.openclaw` which fails in sandboxed environments)

## [0.4.0] - 2025-04-08

### Added

- Persist per-device token from `hello-ok` and use on reconnect for session continuity
