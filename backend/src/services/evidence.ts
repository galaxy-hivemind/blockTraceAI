import { BlockchainRegistrationStatus, IntegrityStatus, Prisma, StorageStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  evidenceActorSelect,
  evidenceIncidentSelect,
  toPublicEvidence,
  type PublicEvidence,
} from "../utils/publicEvidence";
import {
  canonicalMimeType,
  getAllowedExtension,
  hasExpectedSignature,
  isAllowedMimeType,
  normalizeOriginalFilename,
} from "../validation/fileUpload";
import { deleteStoredFile, fileExists, hashFileSha256, restrictFilePermissions, toStoredFilename } from "./storage";

const MAX_CODE_ATTEMPTS = 3;
const HASH_ALGORITHM = "SHA-256";

export type CreateEvidenceInput = {
  incidentId: string;
  collectorId: string;
  originalFilename: string;
  storedAbsolutePath: string;
  mimeType: string | undefined;
  fileSizeBytes: number;
  description?: string;
};

export type CreateEvidenceHooks = {
  afterFileStored?: (storedAbsolutePath: string) => Promise<void>;
};

async function nextEvidenceCode(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const rows = await prisma.$queryRaw<Array<{ nextval: bigint }>>`
    SELECT nextval('evidence_code_seq') AS nextval
  `;
  const sequence = rows[0]?.nextval;
  if (sequence === undefined) {
    throw new Error("Failed to allocate an evidence code");
  }

  return `EVD-${year}-${sequence.toString().padStart(6, "0")}`;
}

const evidenceInclude = {
  incident: { select: evidenceIncidentSelect },
  collector: { select: evidenceActorSelect },
  currentCustodian: { select: evidenceActorSelect },
} as const;

export class EvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceValidationError";
  }
}

export async function createEvidence(
  input: CreateEvidenceInput,
  hooks?: CreateEvidenceHooks,
): Promise<PublicEvidence> {
  const extension = getAllowedExtension(input.originalFilename);
  if (!extension) {
    await deleteStoredFile(input.storedAbsolutePath);
    throw new EvidenceValidationError("Unsupported file type.");
  }

  if (!isAllowedMimeType(extension, input.mimeType)) {
    await deleteStoredFile(input.storedAbsolutePath);
    throw new EvidenceValidationError("Unsupported file type.");
  }

  const exists = await fileExists(input.storedAbsolutePath);
  if (!exists) {
    throw new Error("Stored evidence file is missing");
  }

  const signatureOk = await hasExpectedSignature(input.storedAbsolutePath, extension);
  if (!signatureOk) {
    await deleteStoredFile(input.storedAbsolutePath);
    throw new EvidenceValidationError("Unsupported file type.");
  }

  await restrictFilePermissions(input.storedAbsolutePath);

  if (hooks?.afterFileStored) {
    try {
      await hooks.afterFileStored(input.storedAbsolutePath);
    } catch (error) {
      await deleteStoredFile(input.storedAbsolutePath);
      throw error;
    }
  }

  let sha256HashCached: string;
  try {
    sha256HashCached = await hashFileSha256(input.storedAbsolutePath);
  } catch (error) {
    await deleteStoredFile(input.storedAbsolutePath);
    throw error;
  }

  const storedFilename = toStoredFilename(input.storedAbsolutePath);
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const evidenceCode = await nextEvidenceCode();

    try {
      const evidence = await prisma.evidence.create({
        data: {
          evidenceCode,
          incidentId: input.incidentId,
          originalFilename: normalizeOriginalFilename(input.originalFilename),
          storedFilename,
          mimeType: canonicalMimeType(extension, input.mimeType),
          fileSizeBytes: input.fileSizeBytes,
          sha256HashCached,
          hashAlgorithm: HASH_ALGORITHM,
          description: input.description ?? null,
          collectorId: input.collectorId,
          currentCustodianId: input.collectorId,
          storageLocation: storedFilename,
          storageStatus: StorageStatus.AVAILABLE,
          integrityStatus: IntegrityStatus.UNVERIFIED,
          blockchainRegistrationStatus: BlockchainRegistrationStatus.NOT_REGISTERED,
        },
        include: evidenceInclude,
      });

      return toPublicEvidence(evidence);
    } catch (error) {
      lastError = error;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        await deleteStoredFile(input.storedAbsolutePath);
        throw error;
      }
    }
  }

  await deleteStoredFile(input.storedAbsolutePath);
  throw lastError instanceof Error ? lastError : new Error("Failed to create a unique evidence code");
}

export async function listEvidenceByIncident(incidentId: string): Promise<PublicEvidence[]> {
  const evidence = await prisma.evidence.findMany({
    where: { incidentId },
    orderBy: { createdAt: "desc" },
    include: evidenceInclude,
  });

  return evidence.map(toPublicEvidence);
}

export async function getEvidenceById(id: string): Promise<PublicEvidence | null> {
  const evidence = await prisma.evidence.findUnique({
    where: { id },
    include: evidenceInclude,
  });

  return evidence ? toPublicEvidence(evidence) : null;
}
