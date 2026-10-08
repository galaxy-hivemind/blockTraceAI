import path from "node:path";
import { ethers } from "ethers";
import "dotenv/config";

const repoRoot = path.resolve(__dirname, "../../..");

function readPort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid BACKEND_PORT: ${value}`);
  }

  return parsed;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric environment value: ${value}`);
  }

  return parsed;
}

function resolveStoragePath(value: string | undefined): string {
  if (!value) {
    return path.join(repoRoot, "storage", "evidence");
  }

  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const sessionHours = readPositiveInt(process.env.SESSION_DURATION_HOURS, 8);
const maxUploadMb = readPositiveInt(process.env.MAX_UPLOAD_SIZE_MB, 10);

export const config = {
  port: readPort(process.env.BACKEND_PORT, 4000),
  nodeEnv,
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  sessionSecret: process.env.SESSION_SECRET ?? "replace_with_a_long_random_string",
  sessionDurationMs: sessionHours * 60 * 60 * 1000,
  sessionCookieName: "blocktrace_session",
  cookieSecure: nodeEnv === "production",
  storagePath: resolveStoragePath(process.env.STORAGE_PATH),
  maxUploadMb,
  maxUploadBytes: maxUploadMb * 1024 * 1024,
} as const;

export type BlockchainRuntimeConfig = {
  rpcUrl: string;
  ownerPrivateKey: string | undefined;
  contractAddress: string;
  signerKeysByAddress: Map<string, string>;
};

function collectSignerKeys(): Map<string, string> {
  const keys = [
    process.env.BLOCKTRACE_INVESTIGATOR1_PRIVATE_KEY,
    process.env.BLOCKTRACE_INVESTIGATOR2_PRIVATE_KEY,
    ...(process.env.BLOCKTRACE_SIGNER_PRIVATE_KEYS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  ];

  const map = new Map<string, string>();
  for (const key of keys) {
    if (!key) {
      continue;
    }
    try {
      const wallet = new ethers.Wallet(key);
      map.set(wallet.address.toLowerCase(), key);
    } catch {
      throw new Error("Invalid blockchain signer private key configuration");
    }
  }

  return map;
}

export function getBlockchainRuntimeConfig(): BlockchainRuntimeConfig | null {
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL ?? "http://127.0.0.1:8545";
  const contractAddress = process.env.BLOCKTRACE_CONTRACT_ADDRESS ?? process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    return null;
  }

  if (!ethers.isAddress(contractAddress)) {
    throw new Error("Invalid BLOCKTRACE_CONTRACT_ADDRESS");
  }

  return {
    rpcUrl,
    ownerPrivateKey: process.env.BLOCKCHAIN_PRIVATE_KEY,
    contractAddress: ethers.getAddress(contractAddress),
    signerKeysByAddress: collectSignerKeys(),
  };
}

export function isBlockchainConfigured(): boolean {
  try {
    const configured = getBlockchainRuntimeConfig();
    return configured !== null && configured.signerKeysByAddress.size > 0;
  } catch {
    return false;
  }
}
