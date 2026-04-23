# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-04-23

### Added

- `clientMessageId` option on `chat()` — when provided, yields a `userMessagePersisted` chunk after the Gateway acknowledges receipt of the user message (before the first assistant chunk). Useful for delivery-status tracking.
- `continueLastTurn({ sessionKey })` method — re-triggers the assistant response for the last user message in the session without appending a new user message. Useful for retry flows.

### Fixed

- All test files now use isolated `tmpDir` for device identity (previously relied on `~/.openclaw` which fails in sandboxed environments)

## [0.4.0] - 2025-04-08

### Added

- Persist per-device token from `hello-ok` and use on reconnect for session continuity
