# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.12.0 — 2026-06-03

### Added

- `client.agents.list()` wraps the Gateway's `agents.list` RPC and returns the **runtime** agent list (`{ defaultId, mainKey, scope, agents: [{ id, name, identity, … }] }`). The Gateway derives this from the same `getRuntimeConfig()` view its chat-dispatch handler checks before accepting a message, so it is the authoritative readiness signal: once an agent `id` appears here, a `chat`/`agent` dispatch for that id will not be rejected with `unknown agent id`. This is distinct from `config.get()`, which reads the config FILE and can lead the applied runtime by seconds-to-minutes while a write propagates — the root of the freshly-created-agent dispatch race in Pinchy's E2E suite (see [heypinchy/pinchy#464](https://github.com/heypinchy/pinchy/issues/464)). Polling/deadline policy intentionally lives in the consumer, not here.
- New exported types `AgentsListResult`, `AgentSummary`, `AgentIdentity`.

### Notes

- Wire protocol unchanged (protocol v4). Compatible with the same Gateway versions as 0.11.0 (OC ≥ 2026.5.12); `agents.list` is advertised by OC 2026.5.28. Consumers can guard with `client.hasMethod("agents.list")` before calling on older Gateways.

## 0.11.0 — 2026-05-27

### Added

- Every `ChatChunk` variant now carries the Gateway-correlated `runId`. The Gateway already tags every event payload with `runId` and openclaw-node has been filtering on it internally since 0.x; this release forwards it to consumers so they can route mid-stream events to a server-side run record across a disconnect+reconnect (e.g. Pinchy's Tier 2 streaming-resume work — see [heypinchy/pinchy#310](https://github.com/heypinchy/pinchy/issues/310)).

### Changed

- **BREAKING (TypeScript only):** `ChatChunk` is a discriminated union with a new required `runId: string` field on every variant. The change is purely additive at runtime (no chunk shape changed semantics), but any code that constructs `ChatChunk` literals — e.g. mocks, tests, or middleware — will need to add `runId`. Real consumers that only read chunks from `client.chat()` need no code changes other than picking up the new typings.
- `userMessagePersisted` chunk: gains `runId: string` next to its existing `clientMessageId`, `sessionKey`, `persistedAt` fields.

### Notes

- Wire protocol unchanged. Compatible with the same Gateway versions as 0.10.0 (OC ≥ 2026.5.12).
- For runs that error before the Gateway sends an `accepted` response, openclaw-node falls back to `runId === requestId` (which is the Gateway's own contract for fresh runs).

## 0.10.0 — 2026-05-20

### Changed

- **BREAKING:** advertise Gateway protocol v4 (`minProtocol`/`maxProtocol` = 4) in the connect frame. OC 2026.5.12 raised the minimum required client protocol from 3 to 4 (PR #80725, "require v4 clients and stream explicit `deltaText`/`replace` frames"). Gateways at 2026.5.12+ close v3 clients with code 1002 (`protocol mismatch ... min=3 max=3 expected=4 probeMin=4`) before the handshake completes. This release moves openclaw-node to v4 so it can connect to current Gateway releases.

### Security

- Bump `ws` dependency range to `^8.20.1` to pick up the patched release for [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) (uninitialized memory disclosure in `ws` <8.20.1).

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
