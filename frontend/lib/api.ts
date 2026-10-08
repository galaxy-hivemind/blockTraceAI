export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  role: "ORG_ADMIN" | "INVESTIGATOR" | "AUDITOR";
  status: "ACTIVE" | "DISABLED";
  walletAddress: string | null;
};

export type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IncidentStatus = "OPEN" | "INVESTIGATING" | "CONTAINED" | "RESOLVED" | "CLOSED";

export type IncidentCreator = {
  id: string;
  fullName: string;
  email: string;
  role: PublicUser["role"];
};

export type StorageStatus = "AVAILABLE" | "MISSING";
export type IntegrityStatus = "UNVERIFIED" | "VERIFIED" | "COMPROMISED";
export type BlockchainRegistrationStatus = "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "FAILED";

export type PublicEvidence = {
  id: string;
  evidenceCode: string;
  incidentId: string;
  incident: {
    id: string;
    incidentCode: string;
    name: string;
  };
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256HashCached: string;
  hashAlgorithm: string;
  description: string | null;
  collector: IncidentCreator;
  currentCustodian: IncidentCreator | null;
  storageStatus: StorageStatus;
  integrityStatus: IntegrityStatus;
  blockchainRegistrationStatus: BlockchainRegistrationStatus;
  blockchainEvidenceId: string | null;
  blockchainRegistrationTxId: string | null;
  registeredOnChainAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceBlockchain =
  | { registered: false }
  | {
      registered: true;
      blockchainEvidenceId: string;
      transactionHash: string | null;
      contractAddress: string;
      chainId: number;
      registeredOnChainAt: string | null;
      registeredBy?: string;
      currentCustodian?: string;
      originalHash?: string;
    };

export type PublicIncident = {
  id: string;
  incidentCode: string;
  name: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdBy: IncidentCreator;
  createdAt: string;
  updatedAt: string;
};

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export function apiUrl(path: string): string {
  return `${backendUrl}${path}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function apiUpload(path: string, formData: FormData): Promise<Response> {
  return fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    body: formData,
  });
}

export async function registerEvidence(id: string): Promise<Response> {
  return apiFetch(`/evidence/${id}/register`, { method: "POST" });
}

export async function getEvidenceBlockchain(id: string): Promise<Response> {
  return apiFetch(`/evidence/${id}/blockchain`);
}

export type VerificationResult = "MATCH" | "MISMATCH";
export type BlockchainAuditStatus = "CONFIRMED" | "FAILED" | "UNAVAILABLE";

export type PublicVerification = {
  id: string;
  evidenceId: string;
  result: VerificationResult;
  integrityStatus: IntegrityStatus;
  currentHash: string;
  originalBlockchainHash: string;
  verifiedAt: string;
  verifiedBy: IncidentCreator;
  blockchainAudit: {
    status: BlockchainAuditStatus;
    transactionHash?: string;
    blockNumber?: number;
    recordedBy?: string;
    message?: string;
  };
  notes: string | null;
};

export async function verifyEvidence(id: string): Promise<Response> {
  return apiFetch(`/evidence/${id}/verify`, { method: "POST" });
}

export async function getEvidenceVerifications(id: string): Promise<Response> {
  return apiFetch(`/evidence/${id}/verifications`);
}
