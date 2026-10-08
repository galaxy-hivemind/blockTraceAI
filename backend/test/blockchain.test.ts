import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Role, UserStatus } from "@prisma/client";
import { Contract } from "ethers";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/services/password";
import { REGISTRY_ABI } from "../src/blockchain/registryAbi";
import { bytes32ToSha256Hex, uuidToBytes32 } from "../src/utils/blockchainIds";
import {
  applyBlockchainEnv,
  deployRegistry,
  ensureHardhatNode,
  HARDHAT_INVESTIGATOR1,
  HARDHAT_INVESTIGATOR2,
  HARDHAT_UNAUTHORIZED,
  stopStartedHardhatNode,
} from "./helpers/hardhat";

const app = createApp();
const seedPassword = "BlockTraceDev!2026";
const fixturePath = path.join(__dirname, "fixtures", "server_log.txt");
const createdIncidentIds: string[] = [];
const createdEvidenceIds: string[] = [];
const createdUserIds: string[] = [];
const createdTxIds: string[] = [];

function cookieValue(headers: request.Response["headers"], name: string): string | undefined {
  const raw = headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

function sessionCookieHeader(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0];
}

async function login(email: string, password = seedPassword) {
  const response = await request(app).post("/auth/login").send({ email, password });
  assert.equal(response.status, 200);
  const cookie = cookieValue(response.headers, "blocktrace_session");
  assert.ok(cookie);
  return sessionCookieHeader(cookie);
}

async function uploadEvidence(cookie: string, name: string) {
  const incident = await request(app).post("/incidents").set("Cookie", cookie).send({
    name,
    description: "Incident used by blockchain tests.",
    severity: "HIGH",
  });
  assert.equal(incident.status, 201);
  createdIncidentIds.push(incident.body.incident.id);

  const evidence = await request(app)
    .post(`/incidents/${incident.body.incident.id}/evidence`)
    .set("Cookie", cookie)
    .field("description", "Production server log collected during incident response.")
    .attach("file", fixturePath);
  assert.equal(evidence.status, 201);
  createdEvidenceIds.push(evidence.body.evidence.id);
  return evidence.body.evidence as {
    id: string;
    incidentId: string;
    sha256HashCached: string;
    integrityStatus: string;
  };
}

describe("BlockTrace blockchain registration", () => {
  let contractAddress = "";
  let provider: Awaited<ReturnType<typeof deployRegistry>>["provider"];

  before(async () => {
    await ensureHardhatNode();
    const deployed = await deployRegistry();
    contractAddress = deployed.contractAddress;
    provider = deployed.provider;
    applyBlockchainEnv(contractAddress);
  });

  after(async () => {
    if (createdEvidenceIds.length > 0) {
      const records = await prisma.evidence.findMany({
        where: { id: { in: createdEvidenceIds } },
        select: { blockchainRegistrationTxId: true },
      });
      const hashes = records
        .map((record) => record.blockchainRegistrationTxId)
        .filter((value): value is string => Boolean(value));

      await prisma.blockchainTransaction.deleteMany({
        where: {
          OR: [
            { id: { in: createdTxIds } },
            { txHash: { in: hashes } },
            { submittedById: { in: createdUserIds } },
            { submittedBy: { email: { startsWith: "chain-test-" } } },
          ],
        },
      });
      await prisma.evidence.deleteMany({ where: { id: { in: createdEvidenceIds } } });
    }

    if (createdIncidentIds.length > 0) {
      await prisma.incident.deleteMany({ where: { id: { in: createdIncidentIds } } });
    }

    if (createdUserIds.length > 0) {
      await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.blockchainTransaction.deleteMany({ where: { submittedById: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }

    await stopStartedHardhatNode();
  });

  it("rejects unauthenticated and auditor registration", async () => {
    const investigator = await login("investigator1@blocktrace.local");
    const evidence = await uploadEvidence(investigator, "Auth gate evidence");

    const anonymous = await request(app).post(`/evidence/${evidence.id}/register`);
    assert.equal(anonymous.status, 401);

    const auditor = await login("auditor@blocktrace.local");
    const forbidden = await request(app).post(`/evidence/${evidence.id}/register`).set("Cookie", auditor);
    assert.equal(forbidden.status, 403);

    const txs = await prisma.blockchainTransaction.count({
      where: { functionName: "registerEvidence", submittedBy: { email: "auditor@blocktrace.local" } },
    });
    assert.equal(txs, 0);
  });

  it("rejects missing and malformed evidence IDs", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const missing = await request(app)
      .post("/evidence/11111111-1111-4111-8111-111111111111/register")
      .set("Cookie", cookie);
    assert.equal(missing.status, 404);

    const malformed = await request(app).post("/evidence/not-a-uuid/register").set("Cookie", cookie);
    assert.equal(malformed.status, 400);
  });

  it("rejects registration when the user has no wallet", async () => {
    const passwordHash = await hashPassword("ChainTestPassw0rd!");
    const user = await prisma.user.create({
      data: {
        email: `chain-test-nowallet-${Date.now()}@blocktrace.test`,
        passwordHash,
        fullName: "No Wallet Investigator",
        role: Role.INVESTIGATOR,
        status: UserStatus.ACTIVE,
        walletAddress: null,
      },
    });
    createdUserIds.push(user.id);

    const cookie = await login(user.email, "ChainTestPassw0rd!");
    const evidence = await uploadEvidence(cookie, "No wallet evidence");
    const response = await request(app).post(`/evidence/${evidence.id}/register`).set("Cookie", cookie);
    assert.equal(response.status, 400);
    assert.match(String(response.body.error), /wallet/i);
  });

  it("rejects an invalid cached hash without claiming registration", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadEvidence(cookie, "Invalid hash evidence");
    await prisma.evidence.update({
      where: { id: evidence.id },
      data: { sha256HashCached: "not-a-hash" },
    });

    const response = await request(app).post(`/evidence/${evidence.id}/register`).set("Cookie", cookie);
    assert.equal(response.status, 500);

    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(stored.blockchainRegistrationStatus, "NOT_REGISTERED");
  });

  it("registers Phase 4 evidence on-chain with a matching SHA-256", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadEvidence(cookie, "On-chain hash fixture");

    const response = await request(app).post(`/evidence/${evidence.id}/register`).set("Cookie", cookie);
    assert.equal(response.status, 201);
    assert.equal(response.body.evidence.blockchainRegistrationStatus, "REGISTERED");
    assert.equal(response.body.evidence.integrityStatus, "UNVERIFIED");
    assert.equal(response.body.blockchain.registered, true);
    assert.match(response.body.blockchain.transactionHash, /^0x[0-9a-fA-F]{64}$/);
    assert.equal(response.body.blockchain.contractAddress, contractAddress);
    createdTxIds.push(
      (
        await prisma.blockchainTransaction.findFirstOrThrow({
          where: { txHash: response.body.blockchain.transactionHash },
        })
      ).id,
    );

    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(stored.blockchainRegistrationStatus, "REGISTERED");
    assert.ok(stored.blockchainEvidenceId);
    assert.ok(stored.blockchainRegistrationTxId);
    assert.ok(stored.registeredOnChainAt);
    assert.equal(stored.integrityStatus, "UNVERIFIED");
    assert.equal(stored.blockchainEvidenceId, uuidToBytes32(evidence.id));

    const tx = await prisma.blockchainTransaction.findFirstOrThrow({
      where: { txHash: stored.blockchainRegistrationTxId },
    });
    assert.equal(tx.status, "CONFIRMED");
    assert.equal(tx.functionName, "registerEvidence");
    assert.ok(tx.blockNumber);
    assert.ok(tx.confirmedAt);
    assert.equal(tx.contractAddress, contractAddress);
    assert.ok(tx.chainId);

    const receipt = await provider.getTransactionReceipt(stored.blockchainRegistrationTxId);
    assert.ok(receipt);
    assert.equal(receipt.status, 1);
    assert.ok(receipt.blockNumber);

    const registry = new Contract(contractAddress, REGISTRY_ABI, provider);
    const onChain = await registry.getEvidence(stored.blockchainEvidenceId);
    assert.equal(onChain.exists, true);
    assert.equal(bytes32ToSha256Hex(onChain.sha256Hash), evidence.sha256HashCached);
    assert.equal(onChain.incidentId, uuidToBytes32(evidence.incidentId));
    assert.equal(onChain.registeredBy, HARDHAT_INVESTIGATOR1);
    assert.equal(onChain.currentCustodian, HARDHAT_INVESTIGATOR1);
    assert.ok(onChain.registeredAt > 0n);

    const details = await request(app).get(`/evidence/${evidence.id}/blockchain`).set("Cookie", cookie);
    assert.equal(details.status, 200);
    assert.equal(details.body.registered, true);
    assert.equal(bytes32ToSha256Hex(details.body.originalHash), evidence.sha256HashCached);
    assert.doesNotMatch(JSON.stringify(details.body), /privateKey|passwordHash/i);
  });

  it("rejects a second registration and leaves the on-chain hash unchanged", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadEvidence(cookie, "Duplicate registration");
    const first = await request(app).post(`/evidence/${evidence.id}/register`).set("Cookie", cookie);
    assert.equal(first.status, 201);

    const second = await request(app).post(`/evidence/${evidence.id}/register`).set("Cookie", cookie);
    assert.equal(second.status, 409);

    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    const registry = new Contract(contractAddress, REGISTRY_ABI, provider);
    const onChain = await registry.getEvidence(stored.blockchainEvidenceId);
    assert.equal(bytes32ToSha256Hex(onChain.sha256Hash), evidence.sha256HashCached);
  });

  it("registers investigator2 as a distinct on-chain identity", async () => {
    const cookie = await login("investigator2@blocktrace.local");
    const evidence = await uploadEvidence(cookie, "Investigator two registration");
    const response = await request(app).post(`/evidence/${evidence.id}/register`).set("Cookie", cookie);
    assert.equal(response.status, 201);
    assert.equal(response.body.blockchain.registeredBy, HARDHAT_INVESTIGATOR2);

    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    const registry = new Contract(contractAddress, REGISTRY_ABI, provider);
    const onChain = await registry.getEvidence(stored.blockchainEvidenceId);
    assert.equal(onChain.registeredBy, HARDHAT_INVESTIGATOR2);
    assert.equal(onChain.currentCustodian, HARDHAT_INVESTIGATOR2);
  });

  it("does not register when the wallet is not authorized on the contract", async () => {
    const passwordHash = await hashPassword("ChainTestPassw0rd!");
    const user = await prisma.user.create({
      data: {
        email: `chain-test-unauthorized-${Date.now()}@blocktrace.test`,
        passwordHash,
        fullName: "Unauthorized Wallet",
        role: Role.INVESTIGATOR,
        status: UserStatus.ACTIVE,
        walletAddress: HARDHAT_UNAUTHORIZED,
      },
    });
    createdUserIds.push(user.id);

    const cookie = await login(user.email, "ChainTestPassw0rd!");
    const evidence = await uploadEvidence(cookie, "Unauthorized wallet evidence");
    const response = await request(app).post(`/evidence/${evidence.id}/register`).set("Cookie", cookie);
    assert.equal(response.status, 400);

    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.notEqual(stored.blockchainRegistrationStatus, "REGISTERED");
  });

  it("fails safely when the blockchain RPC is unavailable", async () => {
    const previous = process.env.BLOCKCHAIN_RPC_URL;
    process.env.BLOCKCHAIN_RPC_URL = "http://127.0.0.1:1";

    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadEvidence(cookie, "Offline chain evidence");
    const response = await request(app).post(`/evidence/${evidence.id}/register`).set("Cookie", cookie);
    process.env.BLOCKCHAIN_RPC_URL = previous;

    assert.equal(response.status, 503);
    assert.match(String(response.body.error), /unavailable/i);
    assert.doesNotMatch(JSON.stringify(response.body), /^0x[0-9a-fA-F]{64}$/);

    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.notEqual(stored.blockchainRegistrationStatus, "REGISTERED");
    assert.equal(stored.blockchainRegistrationTxId, null);
  });

  it("lets an auditor view blockchain metadata but not register", async () => {
    const investigator = await login("investigator1@blocktrace.local");
    const evidence = await uploadEvidence(investigator, "Auditor view evidence");
    const registered = await request(app).post(`/evidence/${evidence.id}/register`).set("Cookie", investigator);
    assert.equal(registered.status, 201);

    const auditor = await login("auditor@blocktrace.local");
    const view = await request(app).get(`/evidence/${evidence.id}/blockchain`).set("Cookie", auditor);
    assert.equal(view.status, 200);
    assert.equal(view.body.registered, true);
  });
});
