# BlockTrace Architecture

The project is built incrementally. Phase 1 established the local foundation. Phase 2 added authentication and RBAC. Phase 3 added incident management. Phase 4 added evidence upload, private storage, and server-side SHA-256. Phase 5 anchors that SHA-256 on a local Hardhat blockchain. Phase 6 verifies the current file against that on-chain hash.

## Current Architecture

```
Browser
   ↓
HTTP-only session cookie
   ↓
Express backend
   ↓
Session lookup
   ↓
User
   ↓
RBAC middleware
   ↓
Protected endpoint
```

```
Frontend (Next.js)
        ↓
Backend API (Express + TypeScript)
        ↓
PostgreSQL + Prisma          Private local storage
        ↓
ethers.js
        ↓
Hardhat / local EVM
        ↓
Solidity contract
```

```
Evidence file
    ↓
Private filesystem

Evidence metadata + SHA-256
    ↓
PostgreSQL

Original SHA-256 anchor
    ↓
Hardhat blockchain
```

- The frontend login page calls the real backend. It does not store a session token in `localStorage`, `sessionStorage`, or React state.
- The browser stores only an HTTP-only `blocktrace_session` cookie.
- The backend looks up that session in PostgreSQL, loads the user, and enforces roles.
- The frontend is not the security boundary. Backend authentication and authorization are authoritative.
- The frontend never holds a blockchain private key and never signs transactions.

## Incident Management

```
Authenticated User
        ↓
Incident API
        ↓
Zod validation
        ↓
RBAC
        ↓
Incident Service
        ↓
Prisma
        ↓
PostgreSQL
```

Incident permissions are enforced by the backend:

| Operation       | ORG_ADMIN | INVESTIGATOR | AUDITOR |
| --------------- | --------: | -----------: | ------: |
| Create incident |       YES |          YES |      NO |
| List incidents  |       YES |          YES |     YES |
| View incident   |       YES |          YES |     YES |

Hiding the create button for auditors is only a UX convenience. `POST /incidents` still returns 403 for auditors.

The incident creator is taken from the authenticated session, not from the request body. Incident codes are generated server-side with a PostgreSQL sequence and a unique constraint.

## Evidence Management

```
Browser
   ↓
Multipart Upload
   ↓
Express
   ↓
Authentication
   ↓
RBAC
   ↓
Zod + File Validation
   ↓
Private Filesystem
   ↓
SHA-256
   ↓
Prisma
   ↓
PostgreSQL
```

Storage responsibilities:

- Actual evidence bytes: private filesystem (`storage/evidence`)
- Operational metadata: PostgreSQL
- Integrity hash: SHA-256 calculated server-side from stored bytes
- Blockchain anchoring: Phase 5

Phase 4 calculates and stores the initial SHA-256 locally. This does not yet provide an independent integrity anchor. Blockchain registration is introduced in Phase 5.

Evidence permissions are enforced by the backend:

| Operation                     | ORG_ADMIN | INVESTIGATOR | AUDITOR |
| ----------------------------- | --------: | -----------: | ------: |
| Upload evidence               |       YES |          YES |      NO |
| List incident evidence        |       YES |          YES |     YES |
| View evidence                 |       YES |          YES |     YES |
| Register evidence on-chain    |      YES* |          YES |      NO |
| Verify integrity              |       YES |          YES |     YES |

`*` Application RBAC allows `ORG_ADMIN`, but the Solidity contract only accepts authorized investigator wallets. The seeded admin has no wallet and cannot register.

After upload, `storageStatus` is `AVAILABLE` and `integrityStatus` is `UNVERIFIED`. Upload is not verification. After registration, `blockchainRegistrationStatus` is `REGISTERED` and `integrityStatus` remains `UNVERIFIED`. Registration is not verification.

## Blockchain Registration

```
Phase 4 Evidence
      ↓
Backend reads sha256HashCached
      ↓
Backend converts hash → bytes32
      ↓
Backend selects investigator signer
      ↓
registerEvidence()
      ↓
Hardhat confirmation
      ↓
PostgreSQL transaction metadata
```

Identifier conversion:

- `Evidence.id` and `Incident.id` are UUIDs.
- On-chain IDs are `keccak256(utf8(lowercase canonical UUID))`.
- The same UUID always produces the same `bytes32`.
- The SHA-256 hex digest is passed as the raw 32 bytes. It is not hashed again.

The backend signer is selected from the authenticated user's `walletAddress`. Investigator1 and investigator2 map to distinct Hardhat accounts. The backend does not impersonate another user.

## Integrity Verification

```
Current evidence bytes
        ↓
SHA-256
        ↓
Blockchain original hash
        ↓
Comparison
        ↓
MATCH / MISMATCH
```

The frontend only calls `POST /evidence/:id/verify`. It does not calculate or compare hashes.

`recordVerification()` writes an audit event. It does not change the original on-chain hash and does not decide MATCH/MISMATCH. That decision is made by the backend before the transaction is submitted.

If the requester has no authorized investigator signer, the integrity result is still stored. Blockchain audit status is `UNAVAILABLE` or `FAILED`. The application verifier and the blockchain sender are reported separately when they differ.

Missing file ≠ tampered file. Blockchain unavailable ≠ verified or compromised.

A successful verification proves that the current off-chain file bytes match the SHA-256 originally anchored on the blockchain. It does not prove that the evidence was truthful when initially collected, that the collection process was lawful, or that the blockchain private key was never compromised.

## Authentication Flow

1. A seeded user submits email and password.
2. Zod validates and normalizes the email.
3. The backend verifies the Argon2id password hash.
4. Disabled users are rejected with the same generic error as invalid credentials.
5. A cryptographically random session ID is stored in PostgreSQL.
6. The session ID is set in a signed HTTP-only cookie.
7. Later requests use `requireAuth` and optional `requireRole`.

## Data Stored In PostgreSQL

Application models:

- `User`
- `Session`
- `Incident`
- `Evidence`
- `BlockchainTransaction`
- `Verification`

Enums:

- `Role`: `ORG_ADMIN`, `INVESTIGATOR`, `AUDITOR`
- `UserStatus`: `ACTIVE`, `DISABLED`
- `IncidentSeverity`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
- `IncidentStatus`: `OPEN`, `INVESTIGATING`, `CONTAINED`, `RESOLVED`, `CLOSED`
- `StorageStatus`: `AVAILABLE`, `MISSING`
- `IntegrityStatus`: `UNVERIFIED`, `VERIFIED`, `COMPROMISED`
- `BlockchainRegistrationStatus`: `NOT_REGISTERED`, `PENDING`, `REGISTERED`, `FAILED`
- `BlockchainTransactionStatus`: `PENDING`, `CONFIRMED`, `FAILED`
- `VerificationResult`: `MATCH`, `MISMATCH`

## Why Evidence Files Remain Off-Chain

Evidence files can contain logs, screenshots, reports, or other sensitive material. Blockchain storage is public to the participating network, expensive, and unsuitable for large or confidential files.

BlockTrace stores files off-chain. The chain stores only an evidence identifier and the original SHA-256 hash.

## Why PostgreSQL Is Used

PostgreSQL holds operational application data and transaction references. After evidence registration, it is not the authoritative source for the original evidence hash. That role belongs to the blockchain.

## Limitations

- Local Hardhat only.
- The blockchain does not store files.
- The blockchain does not prove the evidence was truthful when collected.
- The blockchain does not establish legal admissibility.
- The blockchain does not guarantee off-chain file availability.
- Registration is not verification.

## Incremental Development

1. Foundation
2. Authentication
3. Incident management
4. Evidence management
5. Blockchain registration
6. Integrity verification
7. Chain of custody
8. Dashboard
9. Tampering demo
10. Security review
11. Testing
12. Documentation
