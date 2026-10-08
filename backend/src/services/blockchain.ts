import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { REGISTRY_ABI } from "../blockchain/registryAbi";
import { getBlockchainRuntimeConfig } from "../config/env";

export class BlockchainUnavailableError extends Error {
  constructor(message = "Blockchain registration unavailable.") {
    super(message);
    this.name = "BlockchainUnavailableError";
  }
}

export class BlockchainSignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockchainSignerError";
  }
}

export type OnChainEvidence = {
  incidentId: string;
  sha256Hash: string;
  registeredBy: string;
  currentCustodian: string;
  registeredAt: bigint;
  exists: boolean;
};

function createProvider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
}

export async function getBlockchainContext() {
  const config = getBlockchainRuntimeConfig();
  if (!config) {
    throw new BlockchainUnavailableError();
  }

  const provider = createProvider(config.rpcUrl);

  try {
    const network = await provider.getNetwork();
    return {
      config,
      provider,
      chainId: Number(network.chainId),
      contractAddress: config.contractAddress,
    };
  } catch {
    throw new BlockchainUnavailableError();
  }
}

export function getInvestigatorSigner(walletAddress: string, provider: JsonRpcProvider): Wallet {
  const config = getBlockchainRuntimeConfig();
  if (!config) {
    throw new BlockchainUnavailableError();
  }

  const key = config.signerKeysByAddress.get(walletAddress.toLowerCase());
  if (!key) {
    throw new BlockchainSignerError(
      "No backend signer is configured for this user's wallet address.",
    );
  }

  const wallet = new Wallet(key, provider);
  if (wallet.address.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new BlockchainSignerError("Configured signer does not match the user wallet.");
  }

  return wallet;
}

export function getRegistryContract(signerOrProvider: Wallet | JsonRpcProvider, contractAddress: string): Contract {
  return new Contract(contractAddress, REGISTRY_ABI, signerOrProvider);
}

export async function isAuthorizedInvestigator(walletAddress: string): Promise<boolean> {
  const context = await getBlockchainContext();
  const registry = getRegistryContract(context.provider, context.contractAddress);
  return Boolean(await registry.authorizedInvestigators(walletAddress));
}

export async function readOnChainEvidence(blockchainEvidenceId: string): Promise<OnChainEvidence> {
  const context = await getBlockchainContext();
  const registry = getRegistryContract(context.provider, context.contractAddress);
  const record = await registry.getEvidence(blockchainEvidenceId);

  return {
    incidentId: String(record.incidentId),
    sha256Hash: String(record.sha256Hash),
    registeredBy: String(record.registeredBy),
    currentCustodian: String(record.currentCustodian),
    registeredAt: BigInt(record.registeredAt),
    exists: Boolean(record.exists),
  };
}

export type RegisterOnChainInput = {
  evidenceId: string;
  incidentId: string;
  sha256Hash: string;
  investigatorWallet: string;
  initialCustodian: string;
  onSubmitted?: (txHash: string) => Promise<void>;
};

export type RegisterOnChainResult = {
  txHash: string;
  blockNumber: number;
  chainId: number;
  contractAddress: string;
  registeredAt: Date;
};

export async function registerEvidenceOnChain(input: RegisterOnChainInput): Promise<RegisterOnChainResult> {
  const context = await getBlockchainContext();
  const signer = getInvestigatorSigner(input.investigatorWallet, context.provider);
  const registry = getRegistryContract(signer, context.contractAddress);

  const authorized = await registry.authorizedInvestigators(input.investigatorWallet);
  if (!authorized) {
    throw new BlockchainSignerError("Wallet is not authorized on the blockchain registry.");
  }

  let txHash: string | undefined;

  try {
    const tx = await registry.registerEvidence(
      input.evidenceId,
      input.incidentId,
      input.sha256Hash,
      input.initialCustodian,
    );
    txHash = tx.hash;

    if (input.onSubmitted) {
      await input.onSubmitted(tx.hash);
    }

    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      const error = new Error("Blockchain transaction failed.");
      (error as Error & { txHash?: string }).txHash = tx.hash;
      throw error;
    }

    const block = await context.provider.getBlock(receipt.blockNumber);
    const registeredAt = block ? new Date(Number(block.timestamp) * 1000) : new Date();

    return {
      txHash: tx.hash,
      blockNumber: Number(receipt.blockNumber),
      chainId: context.chainId,
      contractAddress: context.contractAddress,
      registeredAt,
    };
  } catch (error) {
    if (txHash && error instanceof Error) {
      (error as Error & { txHash?: string }).txHash = txHash;
    }
    throw error;
  }
}

export type RecordVerificationInput = {
  evidenceId: string;
  computedHash: string;
  matched: boolean;
  investigatorWallet: string;
  onSubmitted?: (txHash: string) => Promise<void>;
};

export type RecordVerificationResult = {
  txHash: string;
  blockNumber: number;
  chainId: number;
  contractAddress: string;
  recordedBy: string;
};

export async function recordVerificationOnChain(input: RecordVerificationInput): Promise<RecordVerificationResult> {
  const context = await getBlockchainContext();
  const signer = getInvestigatorSigner(input.investigatorWallet, context.provider);
  const registry = getRegistryContract(signer, context.contractAddress);

  const authorized = await registry.authorizedInvestigators(input.investigatorWallet);
  if (!authorized) {
    throw new BlockchainSignerError("Wallet is not authorized on the blockchain registry.");
  }

  let txHash: string | undefined;

  try {
    const tx = await registry.recordVerification(input.evidenceId, input.computedHash, input.matched);
    txHash = tx.hash;

    if (input.onSubmitted) {
      await input.onSubmitted(tx.hash);
    }

    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      const error = new Error("Blockchain transaction failed.");
      (error as Error & { txHash?: string }).txHash = tx.hash;
      throw error;
    }

    return {
      txHash: tx.hash,
      blockNumber: Number(receipt.blockNumber),
      chainId: context.chainId,
      contractAddress: context.contractAddress,
      recordedBy: signer.address,
    };
  } catch (error) {
    if (txHash && error instanceof Error) {
      (error as Error & { txHash?: string }).txHash = txHash;
    }
    throw error;
  }
}

export function toSafeBlockchainError(error: unknown): string {
  if (error instanceof BlockchainUnavailableError || error instanceof BlockchainSignerError) {
    return error.message;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("already registered") || message.includes("evidencealreadyregistered")) {
      return "Evidence is already registered on the blockchain.";
    }
    if (message.includes("unauthorized")) {
      return "Wallet is not authorized on the blockchain registry.";
    }
    if (message.includes("failed to fetch") || message.includes("econnrefused") || message.includes("could not detect network")) {
      return "Blockchain unavailable.";
    }
  }

  return "Blockchain operation failed.";
}
