export const REGISTRY_ABI = [
  "function owner() view returns (address)",
  "function authorizedInvestigators(address investigator) view returns (bool)",
  "function registerInvestigator(address investigator, bool allowed)",
  "function registerEvidence(bytes32 evidenceId, bytes32 incidentId, bytes32 sha256Hash, address initialCustodian)",
  "function recordVerification(bytes32 evidenceId, bytes32 computedHash, bool matched)",
  "function getEvidence(bytes32 evidenceId) view returns (bytes32 incidentId, bytes32 sha256Hash, address registeredBy, address currentCustodian, uint256 registeredAt, bool exists)",
] as const;
