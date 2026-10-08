// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title BlockTraceEvidenceRegistry
/// @notice Stores an immutable SHA-256 integrity anchor for digital evidence.
/// @dev Phase 5 registers hashes. Phase 6 records verification events. Custody transfer is later.
contract BlockTraceEvidenceRegistry {
    address public owner;

    mapping(address => bool) public authorizedInvestigators;

    struct EvidenceRecord {
        bytes32 incidentId;
        bytes32 sha256Hash;
        address registeredBy;
        address currentCustodian;
        uint256 registeredAt;
        bool exists;
    }

    mapping(bytes32 => EvidenceRecord) private evidenceRecords;

    event InvestigatorPermissionUpdated(address indexed investigator, bool allowed);

    event EvidenceRegistered(
        bytes32 indexed evidenceId,
        bytes32 indexed incidentId,
        bytes32 sha256Hash,
        address indexed registeredBy,
        address initialCustodian,
        uint256 registeredAt
    );

    event EvidenceVerified(
        bytes32 indexed evidenceId,
        bytes32 computedHash,
        bool matched,
        address indexed verifiedBy,
        uint256 verifiedAt
    );

    error NotOwner();
    error ZeroAddress();
    error UnauthorizedInvestigator();
    error InvalidEvidenceId();
    error InvalidIncidentId();
    error InvalidHash();
    error EvidenceAlreadyRegistered();
    error EvidenceNotRegistered();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    function registerInvestigator(address investigator, bool allowed) external onlyOwner {
        if (investigator == address(0)) {
            revert ZeroAddress();
        }

        authorizedInvestigators[investigator] = allowed;
        emit InvestigatorPermissionUpdated(investigator, allowed);
    }

    function registerEvidence(
        bytes32 evidenceId,
        bytes32 incidentId,
        bytes32 sha256Hash,
        address initialCustodian
    ) external {
        if (!authorizedInvestigators[msg.sender]) {
            revert UnauthorizedInvestigator();
        }
        if (evidenceId == bytes32(0)) {
            revert InvalidEvidenceId();
        }
        if (incidentId == bytes32(0)) {
            revert InvalidIncidentId();
        }
        if (sha256Hash == bytes32(0)) {
            revert InvalidHash();
        }
        if (initialCustodian == address(0)) {
            revert ZeroAddress();
        }
        if (evidenceRecords[evidenceId].exists) {
            revert EvidenceAlreadyRegistered();
        }

        evidenceRecords[evidenceId] = EvidenceRecord({
            incidentId: incidentId,
            sha256Hash: sha256Hash,
            registeredBy: msg.sender,
            currentCustodian: initialCustodian,
            registeredAt: block.timestamp,
            exists: true
        });

        emit EvidenceRegistered(
            evidenceId,
            incidentId,
            sha256Hash,
            msg.sender,
            initialCustodian,
            block.timestamp
        );
    }

    function recordVerification(bytes32 evidenceId, bytes32 computedHash, bool matched) external {
        if (!authorizedInvestigators[msg.sender]) {
            revert UnauthorizedInvestigator();
        }
        if (!evidenceRecords[evidenceId].exists) {
            revert EvidenceNotRegistered();
        }
        if (computedHash == bytes32(0)) {
            revert InvalidHash();
        }

        emit EvidenceVerified(evidenceId, computedHash, matched, msg.sender, block.timestamp);
    }

    function getEvidence(bytes32 evidenceId)
        external
        view
        returns (
            bytes32 incidentId,
            bytes32 sha256Hash,
            address registeredBy,
            address currentCustodian,
            uint256 registeredAt,
            bool exists
        )
    {
        EvidenceRecord storage record = evidenceRecords[evidenceId];
        return (
            record.incidentId,
            record.sha256Hash,
            record.registeredBy,
            record.currentCustodian,
            record.registeredAt,
            record.exists
        );
    }
}
