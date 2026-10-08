import {
  BlockchainRegistrationStatus,
  BlockchainTransactionStatus,
  IntegrityStatus,
  StorageStatus,
  UserStatus,
  VerificationResult,
} from "@prisma/client";
import { ethers } from "ethers";
import { prisma } from "../config/prisma";
import { getBlockchainRuntimeConfig } from "../config/env";
import { bytes32ToSha256Hex, hashesEqual, sha256HexToBytes32, uuidToBytes32 } from "../utils/blockchainIds";
import { evidenceActorSelect, type EvidenceActor, type PublicEvidence } from "../utils/publicEvidence";
import {
  BlockchainSignerError,
  BlockchainUnavailableError,
  getBlockchainContext,
  readOnChainEvidence,
  recordVerificationOnChain,
  toSafeBlockchainError,
} from "./blockchain";
import { fileExists, hashFileSha256, resolveStoredEvidencePath } from "./storage";
import { getEvidenceById } from "./evidence";

export class VerificationHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "VerificationHttpError";
  }
}

export type BlockchainAudit = {
  status: "CONFIRMED" | "FAILED" | "UNAVAILABLE";
  transactionHash?: string;
  blockNumber?: number;
  recordedBy?: string;
  message?: string;
};

export type PublicVerification = {
  id: string;
  evidenceId: string;
  result: VerificationResult;
  integrityStatus: IntegrityStatus;
  currentHash: string;
  originalBlockchainHash: string;
  verifiedAt: Date;
  verifiedBy: EvidenceActor;
  blockchainAudit: BlockchainAudit;
  notes: string | null;
};

export type VerificationResponse = {
  evidence: PublicEvidence;
  verification: PublicVerification;
};

function normalizeWallet(value: string | null | undefined): string | null {
  if (!value || !ethers.isAddress(value)) {
    return null;
  }
  return ethers.getAddress(value);
}

function toPublicVerification(
  record: {
    id: string;
    evidenceId: string;
    result: VerificationResult;
    expectedBlockchainHash: string;
    actualHash: string;
    verifiedAt: Date;
    blockchainTxId: string | null;
    notes: string | null;
    verifiedBy: EvidenceActor;
  },
  integrityStatus: IntegrityStatus,
  audit: BlockchainAudit,
): PublicVerification {
  return {
    id: record.id,
    evidenceId: record.evidenceId,
    result: record.result,
    integrityStatus,
    currentHash: record.actualHash,
    originalBlockchainHash: record.expectedBlockchainHash,
    verifiedAt: record.verifiedAt,
    verifiedBy: record.verifiedBy,
    blockchainAudit: audit,
    notes: record.notes,
  };
}

export async function verifyEvidence(evidenceId: string, verifiedById: string): Promise<VerificationResponse> {
  const user = await prisma.user.findUnique({ where: { id: verifiedById } });
  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new VerificationHttpError(401, "Unauthorized");
  }

  const evidence = await prisma.evidence.findUnique({
    where: { id: evidenceId },
  });
  if (!evidence) {
    throw new VerificationHttpError(404, "Evidence not found");
  }

  if (
    evidence.blockchainRegistrationStatus !== BlockchainRegistrationStatus.REGISTERED ||
    !evidence.blockchainEvidenceId
  ) {
    throw new VerificationHttpError(400, "Evidence must be blockchain registered before integrity verification.");
  }

  let storedPath: string;
  try {
    storedPath = resolveStoredEvidencePath(evidence.storedFilename);
  } catch {
    throw new VerificationHttpError(500, "Internal server error");
  }

  const exists = await fileExists(storedPath);
  if (!exists) {
    await prisma.evidence.update({
      where: { id: evidence.id },
      data: { storageStatus: StorageStatus.MISSING },
    });
    throw new VerificationHttpError(409, "Evidence file is missing from storage. This is not classified as tampering.");
  }

  const actualHash = await hashFileSha256(storedPath);

  let onChain;
  try {
    onChain = await readOnChainEvidence(evidence.blockchainEvidenceId);
  } catch (error) {
    if (error instanceof BlockchainUnavailableError) {
      throw new VerificationHttpError(503, "Blockchain unavailable. Integrity cannot be determined.");
    }
    throw new VerificationHttpError(503, "Blockchain unavailable. Integrity cannot be determined.");
  }

  if (!onChain.exists) {
    throw new VerificationHttpError(409, "On-chain evidence record was not found. Integrity cannot be determined.");
  }

  const expectedId = uuidToBytes32(evidence.id);
  if (evidence.blockchainEvidenceId.toLowerCase() !== expectedId.toLowerCase()) {
    throw new VerificationHttpError(409, "On-chain evidence identifier does not match this evidence record.");
  }

  const originalBlockchainHash = bytes32ToSha256Hex(onChain.sha256Hash);
  const matched = hashesEqual(actualHash, originalBlockchainHash);
  const result = matched ? VerificationResult.MATCH : VerificationResult.MISMATCH;
  const integrityStatus = matched ? IntegrityStatus.VERIFIED : IntegrityStatus.COMPROMISED;

  const persisted = await prisma.$transaction(async (tx) => {
    const verification = await tx.verification.create({
      data: {
        evidenceId: evidence.id,
        verifiedById: user.id,
        expectedBlockchainHash: originalBlockchainHash,
        actualHash,
        result,
      },
      include: { verifiedBy: { select: evidenceActorSelect } },
    });

    const updated = await tx.evidence.update({
      where: { id: evidence.id },
      data: {
        integrityStatus,
        storageStatus: StorageStatus.AVAILABLE,
      },
    });

    return { verification, updated };
  });

  const audit = await recordAuditEvent({
    evidenceId: evidence.id,
    blockchainEvidenceId: evidence.blockchainEvidenceId,
    actualHash,
    matched,
    userId: user.id,
    walletAddress: user.walletAddress,
    verificationId: persisted.verification.id,
  });

  const publicEvidence = await getEvidenceById(evidence.id);
  if (!publicEvidence) {
    throw new VerificationHttpError(404, "Evidence not found");
  }

  return {
    evidence: publicEvidence,
    verification: toPublicVerification(persisted.verification, integrityStatus, audit),
  };
}

async function recordAuditEvent(input: {
  evidenceId: string;
  blockchainEvidenceId: string;
  actualHash: string;
  matched: boolean;
  userId: string;
  walletAddress: string | null;
  verificationId: string;
}): Promise<BlockchainAudit> {
  const wallet = normalizeWallet(input.walletAddress);
  const config = getBlockchainRuntimeConfig();

  if (!wallet || !config?.signerKeysByAddress.has(wallet.toLowerCase())) {
    return {
      status: "UNAVAILABLE",
      message:
        "Integrity result was stored. Blockchain audit recording requires an authorized investigator wallet.",
    };
  }

  let chainId = 31337;
  let contractAddress = config.contractAddress;
  try {
    const context = await getBlockchainContext();
    chainId = context.chainId;
    contractAddress = context.contractAddress;
  } catch {
    return {
      status: "FAILED",
      message: "Integrity result was stored. Blockchain audit recording failed.",
    };
  }

  const transaction = await prisma.blockchainTransaction.create({
    data: {
      txHash: null,
      contractAddress,
      chainId,
      functionName: "recordVerification",
      status: BlockchainTransactionStatus.PENDING,
      submittedById: input.userId,
    },
  });

  try {
    const confirmation = await recordVerificationOnChain({
      evidenceId: input.blockchainEvidenceId,
      computedHash: sha256HexToBytes32(input.actualHash),
      matched: input.matched,
      investigatorWallet: wallet,
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
        confirmedAt: new Date(),
        contractAddress: confirmation.contractAddress,
        chainId: confirmation.chainId,
      },
    });

    await prisma.verification.update({
      where: { id: input.verificationId },
      data: { blockchainTxId: confirmation.txHash },
    });

    return {
      status: "CONFIRMED",
      transactionHash: confirmation.txHash,
      blockNumber: confirmation.blockNumber,
      recordedBy: confirmation.recordedBy,
    };
  } catch (error) {
    const txHash = error instanceof Error && "txHash" in error ? String((error as { txHash?: string }).txHash) : null;
    await prisma.blockchainTransaction.update({
      where: { id: transaction.id },
      data: {
        txHash,
        status: BlockchainTransactionStatus.FAILED,
        errorMessage: toSafeBlockchainError(error),
      },
    });

    if (error instanceof BlockchainSignerError) {
      return {
        status: "FAILED",
        transactionHash: txHash ?? undefined,
        message: "Integrity result was stored. Wallet is not authorized to record a blockchain audit event.",
      };
    }

    return {
      status: "FAILED",
      transactionHash: txHash ?? undefined,
      message: "Integrity result was stored. Blockchain audit recording failed.",
    };
  }
}

export async function listVerifications(evidenceId: string): Promise<PublicVerification[]> {
  const evidence = await prisma.evidence.findUnique({
    where: { id: evidenceId },
    select: { id: true, integrityStatus: true },
  });
  if (!evidence) {
    throw new VerificationHttpError(404, "Evidence not found");
  }

  const records = await prisma.verification.findMany({
    where: { evidenceId },
    orderBy: { verifiedAt: "desc" },
    include: { verifiedBy: { select: evidenceActorSelect } },
  });

  const hashes = records.map((record) => record.blockchainTxId).filter((value): value is string => Boolean(value));
  const transactions = hashes.length
    ? await prisma.blockchainTransaction.findMany({
        where: { txHash: { in: hashes }, functionName: "recordVerification" },
      })
    : [];
  const txByHash = new Map(transactions.map((tx) => [tx.txHash, tx]));

  return records.map((record) => {
    const tx = record.blockchainTxId ? txByHash.get(record.blockchainTxId) : undefined;
    let audit: BlockchainAudit;
    if (tx?.status === BlockchainTransactionStatus.CONFIRMED) {
      audit = {
        status: "CONFIRMED",
        transactionHash: tx.txHash ?? undefined,
        blockNumber: tx.blockNumber !== null ? Number(tx.blockNumber) : undefined,
      };
    } else if (tx?.status === BlockchainTransactionStatus.FAILED) {
      audit = {
        status: "FAILED",
        transactionHash: tx.txHash ?? undefined,
        message: tx.errorMessage ?? "Blockchain audit recording failed.",
      };
    } else if (record.blockchainTxId) {
      audit = { status: "CONFIRMED", transactionHash: record.blockchainTxId };
    } else {
      audit = {
        status: "UNAVAILABLE",
        message: "No blockchain audit transaction is associated with this verification.",
      };
    }

    return toPublicVerification(record, evidence.integrityStatus, audit);
  });
}
