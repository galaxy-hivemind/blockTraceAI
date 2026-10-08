import { ethers } from "ethers";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export class InvalidCachedHashError extends Error {
  constructor() {
    super("Cached SHA-256 is not a valid 64-character hexadecimal digest");
    this.name = "InvalidCachedHashError";
  }
}

/**
 * Deterministic application UUID → bytes32 mapping.
 * keccak256(utf8(lowercase canonical UUID)).
 */
export function uuidToBytes32(uuid: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(uuid.toLowerCase()));
}

/**
 * Convert a Phase 4 SHA-256 hex digest into a bytes32 hex string.
 * Does not hash the hash again.
 */
export function sha256HexToBytes32(hex: string): string {
  const normalized = hex.trim().toLowerCase().replace(/^0x/, "");
  if (!SHA256_HEX.test(normalized)) {
    throw new InvalidCachedHashError();
  }

  return `0x${normalized}`;
}

export function bytes32ToSha256Hex(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, "");
}

export function isValidSha256Hex(hex: string): boolean {
  return SHA256_HEX.test(hex.trim().toLowerCase().replace(/^0x/, ""));
}

export function hashesEqual(left: string, right: string): boolean {
  return bytes32ToSha256Hex(left) === bytes32ToSha256Hex(right);
}
