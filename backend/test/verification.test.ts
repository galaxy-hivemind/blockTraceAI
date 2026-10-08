import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Contract } from "ethers";
import request from "supertest";
import { createApp } from "../src/app";
import { REGISTRY_ABI } from "../src/blockchain/registryAbi";
import { prisma } from "../src/config/prisma";
import { bytes32ToSha256Hex } from "../src/utils/blockchainIds";
import { getStorageRoot } from "../src/services/storage";
import {
  applyBlockchainEnv,
  deployRegistry,
  ensureHardhatNode,
  HARDHAT_OWNER_KEY_B,
  stopStartedHardhatNode,
} from "./helpers/hardhat";

const app = createApp();
const seedPassword = "BlockTraceDev!2026";
const fixturePath = path.join(__dirname, "fixtures", "server_log.txt");
const createdIncidentIds: string[] = [];
const createdEvidenceIds: string[] = [];

function cookieValue(headers: request.Response["headers"], name: string): string | undefined {
  const raw = headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

function sessionCookieHeader(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0];
}

async function login(email: string) {
  const response = await request(app).post("/auth/login").send({ email, password: seedPassword });
  assert.equal(response.status, 200);
  const cookie = cookieValue(response.headers, "blocktrace_session");
  assert.ok(cookie);
  return sessionCookieHeader(cookie);
}

async function uploadAndRegister(cookie: string, name: string) {
  const incident = await request(app).post("/incidents").set("Cookie", cookie).send({
    name,
    description: "Incident used by verification tests.",
    severity: "HIGH",
  });
  assert.equal(incident.status, 201);
  createdIncidentIds.push(incident.body.incident.id);

  const evidence = await request(app)
    .post(`/incidents/${incident.body.incident.id}/evidence`)
    .set("Cookie", cookie)
    .field("description", "Verification fixture.")
    .attach("file", fixturePath);
  assert.equal(evidence.status, 201);
  createdEvidenceIds.push(evidence.body.evidence.id);

  const registered = await request(app).post(`/evidence/${evidence.body.evidence.id}/register`).set("Cookie", cookie);
  assert.equal(registered.status, 201);

  return evidence.body.evidence as {
    id: string;
    sha256HashCached: string;
  };
}

async function storedPath(evidenceId: string): Promise<string> {
  const record = await prisma.evidence.findUniqueOrThrow({
    where: { id: evidenceId },
    select: { storedFilename: true },
  });
  return path.join(getStorageRoot(), record.storedFilename);
}

describe("BlockTrace evidence verification", () => {
  let contractAddress = "";
  let provider: Awaited<ReturnType<typeof deployRegistry>>["provider"];

  before(async () => {
    await ensureHardhatNode();
    const deployed = await deployRegistry(HARDHAT_OWNER_KEY_B);
    contractAddress = deployed.contractAddress;
    provider = deployed.provider;
    applyBlockchainEnv(contractAddress);
  });

  after(async () => {
    if (createdEvidenceIds.length > 0) {
      await prisma.verification.deleteMany({ where: { evidenceId: { in: createdEvidenceIds } } });
      await prisma.blockchainTransaction.deleteMany({
        where: {
          OR: [
            { functionName: "recordVerification", submittedBy: { email: { in: ["investigator1@blocktrace.local", "auditor@blocktrace.local"] } } },
            { txHash: { in: (await prisma.evidence.findMany({ where: { id: { in: createdEvidenceIds } }, select: { blockchainRegistrationTxId: true } })).map((row) => row.blockchainRegistrationTxId).filter((value): value is string => Boolean(value)) } },
          ],
        },
      });
      await prisma.evidence.deleteMany({ where: { id: { in: createdEvidenceIds } } });
    }
    if (createdIncidentIds.length > 0) {
      await prisma.incident.deleteMany({ where: { id: { in: createdIncidentIds } } });
    }
    await stopStartedHardhatNode();
  });

  it("returns MATCH and VERIFIED when the current file matches the blockchain hash", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadAndRegister(cookie, "Verification match");
    const original = (await readFile(fixturePath)).toString("utf8");
    assert.equal(createHash("sha256").update(original).digest("hex"), evidence.sha256HashCached);

    const response = await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", cookie);
    assert.equal(response.status, 201);
    assert.equal(response.body.verification.result, "MATCH");
    assert.equal(response.body.verification.integrityStatus, "VERIFIED");
    assert.equal(response.body.verification.currentHash, evidence.sha256HashCached);
    assert.equal(response.body.verification.originalBlockchainHash, evidence.sha256HashCached);
    assert.equal(response.body.evidence.integrityStatus, "VERIFIED");
    assert.equal(response.body.verification.blockchainAudit.status, "CONFIRMED");
    assert.match(response.body.verification.blockchainAudit.transactionHash, /^0x[0-9a-fA-F]{64}$/);
    assert.doesNotMatch(JSON.stringify(response.body), /passwordHash|storage\/evidence|PRIVATE_KEY/);

    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(stored.sha256HashCached, evidence.sha256HashCached);
    assert.equal(stored.integrityStatus, "VERIFIED");

    const verification = await prisma.verification.findFirstOrThrow({ where: { evidenceId: evidence.id } });
    assert.equal(verification.result, "MATCH");
    assert.equal(verification.actualHash, evidence.sha256HashCached);
    assert.equal(verification.expectedBlockchainHash, evidence.sha256HashCached);

    const tx = await prisma.blockchainTransaction.findFirstOrThrow({
      where: { txHash: response.body.verification.blockchainAudit.transactionHash },
    });
    assert.equal(tx.functionName, "recordVerification");
    assert.equal(tx.status, "CONFIRMED");
    assert.ok(tx.blockNumber);

    const registry = new Contract(contractAddress, REGISTRY_ABI, provider);
    const onChain = await registry.getEvidence(stored.blockchainEvidenceId);
    assert.equal(bytes32ToSha256Hex(onChain.sha256Hash), evidence.sha256HashCached);
  });

  it("returns MISMATCH and COMPROMISED after the stored file is changed", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadAndRegister(cookie, "Verification mismatch");
    const filePath = await storedPath(evidence.id);
    await writeFile(filePath, "tampered-bytes-for-verification\n");
    const tamperedHash = createHash("sha256").update("tampered-bytes-for-verification\n").digest("hex");

    const response = await request(app)
      .post(`/evidence/${evidence.id}/verify`)
      .set("Cookie", cookie)
      .send({ currentHash: evidence.sha256HashCached, expectedHash: evidence.sha256HashCached });
    assert.equal(response.status, 201);
    assert.equal(response.body.verification.result, "MISMATCH");
    assert.equal(response.body.verification.integrityStatus, "COMPROMISED");
    assert.equal(response.body.verification.currentHash, tamperedHash);
    assert.equal(response.body.verification.originalBlockchainHash, evidence.sha256HashCached);
    assert.notEqual(response.body.verification.currentHash, response.body.verification.originalBlockchainHash);

    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(stored.sha256HashCached, evidence.sha256HashCached);
    assert.equal(stored.integrityStatus, "COMPROMISED");

    const registry = new Contract(contractAddress, REGISTRY_ABI, provider);
    const onChain = await registry.getEvidence(stored.blockchainEvidenceId);
    assert.equal(bytes32ToSha256Hex(onChain.sha256Hash), evidence.sha256HashCached);
  });

  it("returns MATCH after the original bytes are restored", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadAndRegister(cookie, "Verification restore");
    const filePath = await storedPath(evidence.id);
    const original = await readFile(fixturePath);

    await writeFile(filePath, "changed-then-restored\n");
    const mismatch = await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", cookie);
    assert.equal(mismatch.body.verification.result, "MISMATCH");

    await writeFile(filePath, original);
    const restored = await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", cookie);
    assert.equal(restored.status, 201);
    assert.equal(restored.body.verification.result, "MATCH");
    assert.equal(restored.body.evidence.integrityStatus, "VERIFIED");
    assert.equal(restored.body.verification.currentHash, evidence.sha256HashCached);
  });

  it("keeps an append-only history across repeated verifications", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadAndRegister(cookie, "Verification history");
    const filePath = await storedPath(evidence.id);
    const original = await readFile(fixturePath);

    await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", cookie);
    await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", cookie);
    await writeFile(filePath, "history-tamper-1\n");
    await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", cookie);
    await writeFile(filePath, "history-tamper-2\n");
    await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", cookie);

    const history = await request(app).get(`/evidence/${evidence.id}/verifications`).set("Cookie", cookie);
    assert.equal(history.status, 200);
    assert.equal(history.body.verifications.length, 4);
    assert.deepEqual(
      history.body.verifications.map((item: { result: string }) => item.result),
      ["MISMATCH", "MISMATCH", "MATCH", "MATCH"],
    );

    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(stored.integrityStatus, "COMPROMISED");
    assert.equal(stored.sha256HashCached, evidence.sha256HashCached);
    await writeFile(filePath, original);
  });

  it("lets an auditor verify and records that blockchain audit is unavailable", async () => {
    const investigator = await login("investigator1@blocktrace.local");
    const evidence = await uploadAndRegister(investigator, "Auditor verification");
    const auditor = await login("auditor@blocktrace.local");
    const response = await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", auditor);
    assert.equal(response.status, 201);
    assert.equal(response.body.verification.result, "MATCH");
    assert.equal(response.body.verification.verifiedBy.email, "auditor@blocktrace.local");
    assert.equal(response.body.verification.blockchainAudit.status, "UNAVAILABLE");
    assert.equal(response.body.verification.blockchainAudit.transactionHash, undefined);
  });

  it("rejects unauthenticated, malformed, missing, and unregistered evidence", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const anonymous = await request(app).post("/evidence/11111111-1111-4111-8111-111111111111/verify");
    assert.equal(anonymous.status, 401);

    const malformed = await request(app).post("/evidence/not-a-uuid/verify").set("Cookie", cookie);
    assert.equal(malformed.status, 400);

    const missing = await request(app)
      .post("/evidence/11111111-1111-4111-8111-111111111111/verify")
      .set("Cookie", cookie);
    assert.equal(missing.status, 404);

    const incident = await request(app).post("/incidents").set("Cookie", cookie).send({
      name: "Unregistered verification",
      description: "Not registered.",
      severity: "LOW",
    });
    createdIncidentIds.push(incident.body.incident.id);
    const uploaded = await request(app)
      .post(`/incidents/${incident.body.incident.id}/evidence`)
      .set("Cookie", cookie)
      .attach("file", fixturePath);
    createdEvidenceIds.push(uploaded.body.evidence.id);

    const unregistered = await request(app).post(`/evidence/${uploaded.body.evidence.id}/verify`).set("Cookie", cookie);
    assert.equal(unregistered.status, 400);
    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: uploaded.body.evidence.id } });
    assert.equal(stored.integrityStatus, "UNVERIFIED");
  });

  it("marks storage MISSING without classifying a missing file as compromised", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadAndRegister(cookie, "Missing file verification");
    await unlink(await storedPath(evidence.id));

    const response = await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", cookie);
    assert.equal(response.status, 409);
    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(stored.storageStatus, "MISSING");
    assert.equal(stored.integrityStatus, "UNVERIFIED");
  });

  it("does not use a tampered PostgreSQL cached hash as the expected value", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadAndRegister(cookie, "Cached hash tamper");
    await prisma.evidence.update({
      where: { id: evidence.id },
      data: { sha256HashCached: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    });

    const response = await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", cookie);
    assert.equal(response.status, 201);
    assert.equal(response.body.verification.result, "MATCH");
    assert.equal(response.body.verification.originalBlockchainHash, evidence.sha256HashCached);
    assert.notEqual(response.body.verification.originalBlockchainHash, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    await prisma.evidence.update({
      where: { id: evidence.id },
      data: { sha256HashCached: evidence.sha256HashCached },
    });
  });

  it("does not determine integrity when the blockchain is unavailable", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const evidence = await uploadAndRegister(cookie, "Offline verification");
    const previous = process.env.BLOCKCHAIN_RPC_URL;
    process.env.BLOCKCHAIN_RPC_URL = "http://127.0.0.1:1";

    const response = await request(app).post(`/evidence/${evidence.id}/verify`).set("Cookie", cookie);
    process.env.BLOCKCHAIN_RPC_URL = previous;

    assert.equal(response.status, 503);
    const stored = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
    assert.equal(stored.integrityStatus, "UNVERIFIED");
  });
});
