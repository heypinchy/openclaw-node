# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
