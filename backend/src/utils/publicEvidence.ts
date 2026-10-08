import type { BlockchainRegistrationStatus, Evidence, IntegrityStatus, Role, StorageStatus } from "@prisma/client";

export type EvidenceActor = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
};

export type EvidenceIncidentSummary = {
  id: string;
  incidentCode: string;
  name: string;
};

export type PublicEvidence = {
  id: string;
  evidenceCode: string;
  incidentId: string;
  incident: EvidenceIncidentSummary;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256HashCached: string;
  hashAlgorithm: string;
  description: string | null;
  collector: EvidenceActor;
  currentCustodian: EvidenceActor | null;
  storageStatus: StorageStatus;
  integrityStatus: IntegrityStatus;
  blockchainRegistrationStatus: BlockchainRegistrationStatus;
  blockchainEvidenceId: string | null;
  blockchainRegistrationTxId: string | null;
  registeredOnChainAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const evidenceActorSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
} as const;

export const evidenceIncidentSelect = {
  id: true,
  incidentCode: true,
  name: true,
} as const;

export function toPublicEvidence(
  evidence: Evidence & {
    incident: EvidenceIncidentSummary;
    collector: EvidenceActor;
    currentCustodian: EvidenceActor | null;
  },
): PublicEvidence {
  return {
    id: evidence.id,
    evidenceCode: evidence.evidenceCode,
    incidentId: evidence.incidentId,
    incident: evidence.incident,
    originalFilename: evidence.originalFilename,
    mimeType: evidence.mimeType,
    fileSizeBytes: evidence.fileSizeBytes,
    sha256HashCached: evidence.sha256HashCached,
    hashAlgorithm: evidence.hashAlgorithm,
    description: evidence.description,
    collector: evidence.collector,
    currentCustodian: evidence.currentCustodian,
    storageStatus: evidence.storageStatus,
    integrityStatus: evidence.integrityStatus,
    blockchainRegistrationStatus: evidence.blockchainRegistrationStatus,
    blockchainEvidenceId: evidence.blockchainEvidenceId,
    blockchainRegistrationTxId: evidence.blockchainRegistrationTxId,
    registeredOnChainAt: evidence.registeredOnChainAt,
    createdAt: evidence.createdAt,
    updatedAt: evidence.updatedAt,
  };
}
