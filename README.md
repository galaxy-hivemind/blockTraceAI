# BlockTrace

Blockchain-based digital evidence integrity and chain of custody.

## Current Phase

Phase 6 — Evidence Integrity Verification

Phases 1–5 are in place. This phase compares the current stored file against the immutable on-chain SHA-256. It does not include custody transfer.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Docker and Docker Compose, for PostgreSQL. Docker Desktop works. Colima plus the Docker CLI also works. If `docker compose` is unavailable, `docker-compose` is accepted.
- Git

## Setup

1. Clone the repository.

```bash
git clone <repository-url>
cd BlockTrace
```

2. Install dependencies from the repository root.

```bash
npm install
```

3. Configure environment variables.

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Edit `.env` and `backend/.env` locally. Do not commit them. Never put `SESSION_SECRET`, `BLOCKCHAIN_PRIVATE_KEY`, `SEED_DEV_PASSWORD`, or database credentials in any `NEXT_PUBLIC_` variable.

4. Start PostgreSQL.

If you are using Colima instead of Docker Desktop, start the runtime first:

```bash
colima start
```

Then start the database:

```bash
npm run db:up
docker compose ps || docker-compose ps
```

Wait until the `postgres` service is healthy.

5. Run migrations and seed users.

```bash
npx prisma migrate dev
npx prisma db seed
```

6. Start the backend.

```bash
npm run dev:backend
```

7. Start the frontend.

```bash
npm run dev:frontend
```

Open [http://localhost:3000](http://localhost:3000) and log in with a development account.

## Development Credentials

Local seed accounts only. These are not production credentials.

| Email | Role | Password |
| --- | --- | --- |
| `admin@blocktrace.local` | `ORG_ADMIN` | `BlockTraceDev!2026` |
| `investigator1@blocktrace.local` | `INVESTIGATOR` | `BlockTraceDev!2026` |
| `investigator2@blocktrace.local` | `INVESTIGATOR` | `BlockTraceDev!2026` |
| `auditor@blocktrace.local` | `AUDITOR` | `BlockTraceDev!2026` |

Passwords are hashed with Argon2id before they are stored. The seed script is idempotent.

Override the seed password locally with `SEED_DEV_PASSWORD` if needed.

## Authentication Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | Public | Validate credentials and set the session cookie |
| `POST` | `/auth/logout` | Cookie optional | Invalidate the session and clear the cookie |
| `GET` | `/auth/me` | Required | Return the current user |
| `GET` | `/health` | Public | Process health check |
| `GET` | `/protected` | Required | Auth demonstration only |
| `GET` | `/protected/admin` | `ORG_ADMIN` | RBAC demonstration only |
| `GET` | `/protected/investigator` | `INVESTIGATOR` | RBAC demonstration only |
| `GET` | `/protected/auditor` | `AUDITOR` | RBAC demonstration only |

`/protected*` routes exist only to exercise middleware. They are not future evidence APIs.

## Incident Management

Incidents are stored in PostgreSQL. The backend generates `incidentCode` and sets `createdById` from the session.

| Operation | ORG_ADMIN | INVESTIGATOR | AUDITOR |
| --- | ---: | ---: | ---: |
| Create incident | YES | YES | NO |
| List incidents | YES | YES | YES |
| View incident | YES | YES | YES |

These permissions are enforced by the backend.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/incidents` | `ORG_ADMIN`, `INVESTIGATOR` | Create an incident |
| `GET` | `/incidents` | Any authenticated role | List incidents |
| `GET` | `/incidents/:id` | Any authenticated role | View incident details |

Example create request:

```json
{
  "name": "Ransomware Attack - Server-01",
  "description": "Suspected ransomware activity detected on production server.",
  "severity": "HIGH"
}
```

Successful creation returns HTTP 201 and a server-generated code such as `INC-2026-000001`. Status defaults to `OPEN`.

Frontend routes:

- `/incidents` — list
- `/incidents/new` — create form
- `/incidents/[id]` — details

The development seed does not create sample incidents. Create them through the API or UI.

## Evidence Management

Evidence files are stored in a private directory, default `storage/evidence`. They are never served from Next.js `public/`.

Supported types: `.txt`, `.log`, `.json`, `.csv`, `.pdf`, `.png`, `.jpg`, `.zip`. Maximum size is 10 MB (`MAX_UPLOAD_SIZE_MB`).

The backend calculates SHA-256 from the stored file bytes. The client cannot supply the hash, collector, custodian, or storage path.

After upload:

- `storageStatus` = `AVAILABLE`
- `integrityStatus` = `UNVERIFIED`
- `hashAlgorithm` = `SHA-256`

Phase 4 calculates and stores the initial SHA-256 locally. Phase 5 can then register that hash on the local blockchain.

| Operation | ORG_ADMIN | INVESTIGATOR | AUDITOR |
| --- | ---: | ---: | ---: |
| Upload evidence | YES | YES | NO |
| List incident evidence | YES | YES | YES |
| View evidence | YES | YES | YES |
| Register evidence on-chain | YES* | YES | NO |
| Verify integrity | YES | YES | YES |

`ORG_ADMIN` may call the registration API only if that admin has an authorized investigator wallet. The seeded admin has no wallet, so registration is rejected rather than impersonating another user.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/incidents/:incidentId/evidence` | `ORG_ADMIN`, `INVESTIGATOR` | Upload evidence |
| `GET` | `/incidents/:incidentId/evidence` | Any authenticated role | List evidence for an incident |
| `GET` | `/evidence/:id` | Any authenticated role | View evidence metadata |
| `POST` | `/evidence/:id/register` | `ORG_ADMIN`, `INVESTIGATOR` | Register cached SHA-256 on-chain |
| `GET` | `/evidence/:id/blockchain` | Any authenticated role | Read blockchain registration metadata |
| `POST` | `/evidence/:id/verify` | Any authenticated role | Compare current file to on-chain hash |
| `GET` | `/evidence/:id/verifications` | Any authenticated role | List verification history |

Frontend routes:

- `/incidents/[id]/evidence/new` — upload form
- `/evidence/[id]` — evidence details

Set `STORAGE_PATH` and `MAX_UPLOAD_SIZE_MB` in backend environment files only. Do not use `NEXT_PUBLIC_` for storage configuration.

## Blockchain Registration

The blockchain stores the original SHA-256 as an immutable integrity anchor. It does not store the evidence file.

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

Registration uses only the server-side `sha256HashCached` value. The client cannot supply the hash, evidence ID, incident ID, or wallet.

`REGISTERED` means the cached SHA-256 was confirmed on-chain. It does **not** mean the current file was verified. `integrityStatus` stays `UNVERIFIED` until Phase 6 verification.

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
        ↓
VERIFIED / COMPROMISED
```

After registration, the authoritative original hash is `BlockTraceEvidenceRegistry.sha256Hash`. PostgreSQL `sha256HashCached` is historical metadata and is never used as the expected value.

A missing file sets `storageStatus = MISSING`. That is not tampering and does not set `COMPROMISED`.

If Hardhat is unavailable, verification returns an error and does not guess MATCH or MISMATCH.

Auditors may request verification. The integrity result is stored in PostgreSQL. `recordVerification()` is only submitted when the authenticated user has an authorized investigator wallet. The API distinguishes the application verifier from the blockchain transaction sender.

A successful verification proves that the current off-chain file bytes match the SHA-256 originally anchored on the blockchain. It does not prove that the evidence was truthful when initially collected, that the collection process was lawful, or that the blockchain private key was never compromised.

### Local startup order

1. Start PostgreSQL: `npm run db:up`
2. Apply migrations and seed: `npx prisma migrate dev` then `npx prisma db seed`
3. Start Hardhat: `npm run blockchain:node`
4. Deploy the contract: `npm run blockchain:deploy`
5. Copy `BLOCKTRACE_CONTRACT_ADDRESS` into `backend/.env` and `.env`
6. Start the backend: `npm run dev:backend`
7. Start the frontend: `npm run dev:frontend`

### Development wallets

These are Hardhat Network accounts. Addresses are stored on `User.walletAddress`. Private keys stay in backend environment files.

| Application user | Hardhat account | Address |
| --- | ---: | --- |
| `investigator1@blocktrace.local` | #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| `investigator2@blocktrace.local` | #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| Deployer / contract owner | #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |

The deployer authorizes investigator1 and investigator2 during `npm run blockchain:deploy`. Auditors are not authorized.

ID conversion: `keccak256(utf8(lowercase UUID))` for both `Evidence.id` and `Incident.id`. The SHA-256 hex digest is passed as raw `bytes32` and is not hashed again.

### Local reset

These commands are destructive. Do not run them during normal development.

```bash
npm run db:down
npm run db:up
npx prisma migrate dev
npx prisma db seed
rm -f storage/evidence/*
# keep storage/evidence/.gitkeep
# restart Hardhat, then:
npm run blockchain:deploy
```

Then copy the new contract address into backend environment files.

### Limitations

- Local Hardhat only. No public RPC, testnet, or explorer links.
- The blockchain does not store files or prove the evidence was truthful when collected.
- Registration is not legal admissibility and does not guarantee the off-chain file still exists.
- Frontend never signs transactions and never receives a private key.

## Session Behavior

- Sessions live in PostgreSQL.
- The browser receives a signed HTTP-only `blocktrace_session` cookie.
- Default lifetime is 8 hours, configurable with `SESSION_DURATION_HOURS`.
- `secure` is enabled only when `NODE_ENV=production`.
- Expired or missing sessions return HTTP 401.
- Logout deletes the server-side session and clears the cookie.

## Roles

- `ORG_ADMIN` — organization administrator
- `INVESTIGATOR` — evidence custodian and investigator
- `AUDITOR` — read-oriented reviewer

The frontend is not the security boundary. Backend authentication and authorization are authoritative.

## Development Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install workspace dependencies |
| `npm run db:up` | Start PostgreSQL with Docker Compose |
| `npm run db:down` | Stop PostgreSQL |
| `npm run dev:frontend` | Start Next.js in development mode |
| `npm run dev:backend` | Start Express with TypeScript reload |
| `npm run build:frontend` | Type-check and build the frontend |
| `npm run build:backend` | Type-check the backend |
| `npm run prisma:validate` | Validate `prisma/schema.prisma` |
| `npm run prisma:generate` | Generate the Prisma client |
| `npx prisma migrate dev` | Apply Prisma migrations |
| `npx prisma db seed` | Seed the four development users |
| `echo 'SELECT 1;' \| npm run prisma:ping` | Check that Prisma can reach PostgreSQL |
| `npm run test:backend` | Run authentication, incident, evidence, and blockchain tests |
| `npm run blockchain:compile` | Compile the Hardhat project |
| `npm run blockchain:node` | Start the local Hardhat JSON-RPC node |
| `npm run blockchain:test` | Run Solidity tests |
| `npm run blockchain:deploy` | Deploy the registry to the running Hardhat node |

## Architecture

Current local development layout:

- Frontend: Next.js process on port 3000
- Backend: Express process on port 4000
- PostgreSQL: Docker Compose on port 5432
- Auth: Argon2id passwords and HTTP-only server-side sessions
- Incidents: PostgreSQL-backed create, list, and details
- Evidence: private filesystem plus PostgreSQL metadata and server-side SHA-256
- Blockchain: Hardhat Network plus `BlockTraceEvidenceRegistry`
- Storage: private `storage/` directory for evidence files

See [docs/architecture.md](docs/architecture.md) for the current and future architecture.

## Important Security Rules

- Never commit `.env`, `.env.local`, or other secret files.
- Never commit uploaded evidence. `storage/` stays empty in git.
- Never expose blockchain private keys, session secrets, or database credentials to the frontend.
- Evidence files must remain private and must never be served from Next.js `public/`.
- The frontend is not a security boundary. Authorization must be enforced by the backend.
