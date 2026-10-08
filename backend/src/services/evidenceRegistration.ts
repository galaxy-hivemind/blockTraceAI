import {
  BlockchainRegistrationStatus,
  BlockchainTransactionStatus,
  IntegrityStatus,
  UserStatus,
} from "@prisma/client";
import { ethers } from "ethers";
import { prisma } from "../config/prisma";
import { getBlockchainRuntimeConfig } from "../config/env";
import {
  evidenceActorSelect,
  evidenceIncidentSelect,
  toPublicEvidence,
  type PublicEvidence,
} from "../utils/publicEvidence";
import { bytes32ToSha256Hex, InvalidCachedHashError, isValidSha256Hex, sha256HexToBytes32, uuidToBytes32 } from "../utils/blockchainIds";
import {
  BlockchainSignerError,
  BlockchainUnavailableError,
  getBlockchainContext,
  readOnChainEvidence,
  registerEvidenceOnChain,
  toSafeBlockchainError,
} from "./blockchain";

const evidenceInclude = {
  incident: { select: evidenceIncidentSelect },
  collector: { select: evidenceActorSelect },
  currentCustodian: { select: evidenceActorSelect },
} as const;

export class RegistrationHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "RegistrationHttpError";
  }
}

export type RegistrationResult = {
  evidence: PublicEvidence;
  blockchain: {
    registered: true;
    blockchainEvidenceId: string;
    transactionHash: string;
    contractAddress: string;
    chainId: number;
    registeredOnChainAt: Date;
    registeredBy: string;
    currentCustodian: string;
    originalHash: string;
  };
};

export type BlockchainMetadata =
  | { registered: false }
  | {
      registered: true;
      blockchainEvidenceId: string;
      transactionHash: string | null;
      contractAddress: string;
      chainId: number;
      registeredOnChainAt: Date | null;
      registeredBy?: string;
      currentCustodian?: string;
      originalHash?: string;
    };

function normalizeWallet(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (!ethers.isAddress(value)) {
    return null;
  }
  return ethers.getAddress(value);
}

async function loadEvidenceRecord(id: string) {
  return prisma.evidence.findUnique({
    where: { id },
    include: evidenceInclude,
  });
}

export async function registerEvidence(evidenceId: string, submittedById: string): Promise<RegistrationResult> {
  const user = await prisma.user.findUnique({
    where: { id: submittedById },
  });
  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new RegistrationHttpError(401, "Unauthorized");
  }

  const evidence = await loadEvidenceRecord(evidenceId);
  if (!evidence) {
    throw new RegistrationHttpError(404, "Evidence not found");
  }

  if (evidence.blockchainRegistrationStatus === BlockchainRegistrationStatus.REGISTERED) {
    throw new RegistrationHttpError(409, "Evidence is already registered on the blockchain.");
  }

  if (evidence.blockchainRegistrationStatus === BlockchainRegistrationStatus.PENDING) {
    throw new RegistrationHttpError(409, "Evidence registration is already in progress.");
  }

  if (!evidence.sha256HashCached || !isValidSha256Hex(evidence.sha256HashCached)) {
    throw new RegistrationHttpError(500, "Internal server error");
  }

  const wallet = normalizeWallet(user.walletAddress);
  if (!wallet) {
    throw new RegistrationHttpError(
      400,
      "The authenticated user does not have an authorized blockchain wallet.",
    );
  }

  const config = getBlockchainRuntimeConfig();
  if (!config || config.signerKeysByAddress.size === 0) {
    throw new RegistrationHttpError(503, "Blockchain registration unavailable.");
  }

  if (!config.signerKeysByAddress.has(wallet.toLowerCase())) {
    throw new RegistrationHttpError(
      400,
      "No backend signer is configured for this user's wallet address.",
    );
  }

  const claimed = await prisma.evidence.updateMany({
    where: {
      id: evidenceId,
      blockchainRegistrationStatus: {
        in: [BlockchainRegistrationStatus.NOT_REGISTERED, BlockchainRegistrationStatus.FAILED],
      },
    },
    data: {
      blockchainRegistrationStatus: BlockchainRegistrationStatus.PENDING,
    },
  });

  if (claimed.count === 0) {
    const current = await loadEvidenceRecord(evidenceId);
    if (!current) {
      throw new RegistrationHttpError(404, "Evidence not found");
    }
    if (current.blockchainRegistrationStatus === BlockchainRegistrationStatus.REGISTERED) {
      throw new RegistrationHttpError(409, "Evidence is already registered on the blockchain.");
    }
    throw new RegistrationHttpError(409, "Evidence registration is already in progress.");
  }

  let chainId = 31337;
  let contractAddress = config.contractAddress;
  try {
    const context = await getBlockchainContext();
    chainId = context.chainId;
    contractAddress = context.contractAddress;
  } catch (error) {
    await markFailed(evidenceId, submittedById, null, contractAddress, chainId, toSafeBlockchainError(error));
    throw new RegistrationHttpError(503, "Blockchain registration unavailable.");
  }

  const transaction = await prisma.blockchainTransaction.create({
    data: {
      txHash: null,
      contractAddress,
      chainId,
      functionName: "registerEvidence",
      status: BlockchainTransactionStatus.PENDING,
      submittedById,
    },
  });

  try {
    const blockchainEvidenceId = uuidToBytes32(evidence.id);
    const onChainIncidentId = uuidToBytes32(evidence.incidentId);
    const onChainHash = sha256HexToBytes32(evidence.sha256HashCached);

    const confirmation = await registerEvidenceOnChain({
      evidenceId: blockchainEvidenceId,
      incidentId: onChainIncidentId,
      sha256Hash: onChainHash,
      investigatorWallet: wallet,
      initialCustodian: wallet,
      onSubmitted: async (txHash) => {
        await prisma.blockchainTransaction.update({
          where: { id: transaction.id },
          data: { txHash },
        });
      },
    });

    await prisma.blockchainTransaction.update({
      where: { id: transaction.id },
      data: {
        txHash: confirmation.txHash,
        status: BlockchainTransactionStatus.CONFIRMED,
        blockNumber: BigInt(confirmation.blockNumber),
        confirmedAt: confirmation.registeredAt,
        contractAddress: confirmation.contractAddress,
        chainId: confirmation.chainId,
      },
    });

    const updated = await prisma.evidence.update({
      where: { id: evidence.id },
      data: {
        blockchainEvidenceId,
        blockchainRegistrationTxId: confirmation.txHash,
        registeredOnChainAt: confirmation.registeredAt,
        blockchainRegistrationStatus: BlockchainRegistrationStatus.REGISTERED,
        integrityStatus: IntegrityStatus.UNVERIFIED,
      },
      include: evidenceInclude,
    });

    return {
      evidence: toPublicEvidence(updated),
      blockchain: {
        registered: true,
        blockchainEvidenceId,
        transactionHash: confirmation.txHash,
        contractAddress: confirmation.contractAddress,
        chainId: confirmation.chainId,
        registeredOnChainAt: confirmation.registeredAt,
        registeredBy: wallet,
        currentCustodian: wallet,
        originalHash: onChainHash,
      },
    };
  } catch (error) {
    if (error instanceof InvalidCachedHashError) {
      await failTransaction(transaction.id, evidenceId, null, "Internal server error");
      throw new RegistrationHttpError(500, "Internal server error");
    }

    const txHash = error instanceof Error && "txHash" in error ? String((error as { txHash?: string }).txHash) : null;
    const safeMessage = toSafeBlockchainError(error);
    await failTransaction(transaction.id, evidenceId, txHash, safeMessage);

    if (error instanceof BlockchainUnavailableError) {
      throw new RegistrationHttpError(503, safeMessage);
    }
    if (error instanceof BlockchainSignerError) {
      throw new RegistrationHttpError(400, safeMessage);
    }
    throw new RegistrationHttpError(502, safeMessage);
  }
}

async function failTransaction(
  transactionId: string,
  evidenceId: string,
  txHash: string | null,
  errorMessage: string,
): Promise<void> {
  await prisma.blockchainTransaction.update({
    where: { id: transactionId },
    data: {
      txHash,
      status: BlockchainTransactionStatus.FAILED,
      errorMessage,
    },
  });

  await prisma.evidence.update({
    where: { id: evidenceId },
    data: {
      blockchainRegistrationStatus: BlockchainRegistrationStatus.FAILED,
    },
  });
}

async function markFailed(
  evidenceId: string,
  submittedById: string,
  txHash: string | null,
  contractAddress: string,
  chainId: number,
  errorMessage: string,
): Promise<void> {
  await prisma.blockchainTransaction.create({
    data: {
      txHash,
      contractAddress,
      chainId,
      functionName: "registerEvidence",
      status: BlockchainTransactionStatus.FAILED,
      submittedById,
      errorMessage,
    },
  });

  await prisma.evidence.update({
    where: { id: evidenceId },
    data: {
      blockchainRegistrationStatus: BlockchainRegistrationStatus.FAILED,
    },
  });
}

export async function getEvidenceBlockchain(evidenceId: string): Promise<BlockchainMetadata> {
  const evidence = await prisma.evidence.findUnique({
    where: { id: evidenceId },
  });
  if (!evidence) {
    throw new RegistrationHttpError(404, "Evidence not found");
  }

  if (
    evidence.blockchainRegistrationStatus !== BlockchainRegistrationStatus.REGISTERED ||
    !evidence.blockchainEvidenceId
  ) {
    return { registered: false };
  }

  try {
    const context = await getBlockchainContext();
    const onChain = await readOnChainEvidence(evidence.blockchainEvidenceId);
    if (!onChain.exists) {
      return { registered: false };
    }

    return {
      registered: true,
      blockchainEvidenceId: evidence.blockchainEvidenceId,
      transactionHash: evidence.blockchainRegistrationTxId,
      contractAddress: context.contractAddress,
      chainId: context.chainId,
      registeredOnChainAt: evidence.registeredOnChainAt,
      registeredBy: onChain.registeredBy,
      currentCustodian: onChain.currentCustodian,
      originalHash: `0x${bytes32ToSha256Hex(onChain.sha256Hash)}`,
    };
  } catch {
    const persisted = await prisma.blockchainTransaction.findFirst({
      where: {
        txHash: evidence.blockchainRegistrationTxId ?? undefined,
        functionName: "registerEvidence",
        status: BlockchainTransactionStatus.CONFIRMED,
      },
      orderBy: { submittedAt: "desc" },
    });

    if (!evidence.blockchainRegistrationTxId || !persisted) {
      return { registered: false };
    }

    return {
      registered: true,
      blockchainEvidenceId: evidence.blockchainEvidenceId,
      transactionHash: evidence.blockchainRegistrationTxId,
      contractAddress: persisted.contractAddress,
      chainId: persisted.chainId,
      registeredOnChainAt: evidence.registeredOnChainAt,
    };
  }
}
