export { OpenClawClient, parsePairingRequiredReason } from "./client";
export type { OpenClawClientOptions, ChatOptions, ChatChunk } from "./client";
export { isValidProtocolMessage } from "./types";
export type {
  ConnectionState,
  ConnectParams,
  ConnectChallenge,
  AuthParams,
  DeviceIdentity,
  HelloOk,
  PairingRequiredEvent,
  ProtocolRequest,
  ProtocolResponse,
  ProtocolEvent,
  ProtocolMessage,
  ClientRole,
  ClientEventMap,
  ChatAttachment,
  ConfigGetResult,
} from "./types";
