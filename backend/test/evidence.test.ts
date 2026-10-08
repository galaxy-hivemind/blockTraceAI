import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { createEvidence } from "../src/services/evidence";
import { fileExists, getStorageRoot } from "../src/services/storage";

const app = createApp();
const seedPassword = "BlockTraceDev!2026";
const createdIncidentIds: string[] = [];
const createdEvidenceIds: string[] = [];
const fixturePath = path.join(__dirname, "fixtures", "server_log.txt");

const minimalPng = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);
const minimalJpg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
const minimalPdf = Buffer.from("%PDF-1.1\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
const minimalZip = Buffer.from("504b03041400000000000000000000000000000000000000000000", "hex");

function cookieValue(headers: request.Response["headers"], name: string): string | undefined {
  const raw = headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

function sessionCookieHeader(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0];
}

async function login(email: string) {
  const response = await request(app).post("/auth/login").send({
    email,
    password: seedPassword,
  });
  assert.equal(response.status, 200);
  const cookie = cookieValue(response.headers, "blocktrace_session");
  assert.ok(cookie);
  return sessionCookieHeader(cookie);
}

async function createIncident(cookie: string, name: string) {
  const response = await request(app).post("/incidents").set("Cookie", cookie).send({
    name,
    description: "Incident used by evidence tests.",
    severity: "HIGH",
  });
  assert.equal(response.status, 201);
  createdIncidentIds.push(response.body.incident.id);
  return response.body.incident as { id: string };
}

function assertSafePayload(body: unknown): void {
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /passwordHash/);
  assert.doesNotMatch(serialized, /"password":/);
  assert.doesNotMatch(serialized, /storage\/evidence/);
  assert.doesNotMatch(serialized, /Users\//);
}

describe("BlockTrace evidence", () => {
  after(async () => {
    if (createdEvidenceIds.length > 0) {
      const records = await prisma.evidence.findMany({
        where: { id: { in: createdEvidenceIds } },
        select: { storedFilename: true },
      });
      await prisma.evidence.deleteMany({
        where: { id: { in: createdEvidenceIds } },
      });
      await Promise.all(
        records.map(async (record) => {
          const absolutePath = path.join(getStorageRoot(), record.storedFilename);
          if (await fileExists(absolutePath)) {
            const { unlink } = await import("node:fs/promises");
            await unlink(absolutePath);
          }
        }),
      );
    }

    if (createdIncidentIds.length > 0) {
      await prisma.incident.deleteMany({
        where: { id: { in: createdIncidentIds } },
      });
    }
  });

  it("stores valid text evidence, hashes stored bytes, and keeps the file private", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const incident = await createIncident(cookie, "Evidence hash fixture");
    const expectedHash = createHash("sha256").update(await readFile(fixturePath)).digest("hex");

    const response = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .set("Cookie", cookie)
      .field("description", "Production server log collected during incident response.")
      .attach("file", fixturePath);

    assert.equal(response.status, 201);
    assert.match(response.body.evidence.evidenceCode, /^EVD-\d{4}-\d{6}$/);
    assert.equal(response.body.evidence.storageStatus, "AVAILABLE");
    assert.equal(response.body.evidence.integrityStatus, "UNVERIFIED");
    assert.equal(response.body.evidence.hashAlgorithm, "SHA-256");
    assert.equal(response.body.evidence.sha256HashCached, expectedHash);
    assert.equal(response.body.evidence.collector.email, "investigator1@blocktrace.local");
    assert.equal(response.body.evidence.currentCustodian.email, "investigator1@blocktrace.local");
    assert.equal(response.body.evidence.incidentId, incident.id);
    assert.notEqual(response.body.evidence.originalFilename, response.body.evidence.storedFilename);
    assertSafePayload(response.body);
    createdEvidenceIds.push(response.body.evidence.id);

    const stored = await prisma.evidence.findUniqueOrThrow({
      where: { id: response.body.evidence.id },
    });
    assert.equal(stored.sha256HashCached, expectedHash);
    assert.equal(stored.collectorId, stored.currentCustodianId);
    assert.notEqual(stored.storedFilename, "server_log.txt");

    const storedPath = path.join(getStorageRoot(), stored.storedFilename);
    assert.equal(await fileExists(storedPath), true);
    const storedBytes = await readFile(storedPath);
    const originalBytes = await readFile(fixturePath);
    assert.deepEqual(storedBytes, originalBytes);
    assert.equal(createHash("sha256").update(storedBytes).digest("hex"), expectedHash);
  });

  it("accepts supported types and rejects unsupported or oversized files", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const incident = await createIncident(cookie, "Evidence type fixture");

    const accepted = [
      { name: "notes.txt", body: Buffer.from("plain text evidence\n") },
      { name: "app.log", body: Buffer.from("error line\n") },
      { name: "data.json", body: Buffer.from("{\"ok\":true}") },
      { name: "rows.csv", body: Buffer.from("a,b\n1,2\n") },
      { name: "report.pdf", body: minimalPdf },
      { name: "shot.png", body: minimalPng },
      { name: "photo.jpg", body: minimalJpg },
      { name: "bundle.zip", body: minimalZip },
    ];

    for (const file of accepted) {
      const response = await request(app)
        .post(`/incidents/${incident.id}/evidence`)
        .set("Cookie", cookie)
        .attach("file", file.body, file.name);
      assert.equal(response.status, 201, file.name);
      createdEvidenceIds.push(response.body.evidence.id);
    }

    const unsupported = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from("malware"), "payload.exe");
    assert.equal(unsupported.status, 400);

    const oversized = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .set("Cookie", cookie)
      .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1), "huge.txt");
    assert.equal(oversized.status, 413);
  });

  it("does not use a traversal filename as the stored path", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const incident = await createIncident(cookie, "Evidence path fixture");
    const response = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from("safe text\n"), "../../../etc/passwd.txt");

    assert.equal(response.status, 201);
    createdEvidenceIds.push(response.body.evidence.id);
    const stored = await prisma.evidence.findUniqueOrThrow({
      where: { id: response.body.evidence.id },
    });
    assert.equal(path.basename(stored.storedFilename), stored.storedFilename);
    assert.doesNotMatch(stored.storedFilename, /\.\./);
    assert.equal(await fileExists(path.join(getStorageRoot(), stored.storedFilename)), true);
  });

  it("enforces upload RBAC", async () => {
    const investigatorCookie = await login("investigator1@blocktrace.local");
    const incident = await createIncident(investigatorCookie, "Evidence RBAC fixture");

    const adminCookie = await login("admin@blocktrace.local");
    const adminUpload = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .set("Cookie", adminCookie)
      .attach("file", Buffer.from("admin note\n"), "admin.txt");
    assert.equal(adminUpload.status, 201);
    createdEvidenceIds.push(adminUpload.body.evidence.id);

    const auditorCookie = await login("auditor@blocktrace.local");
    const auditorUpload = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .set("Cookie", auditorCookie)
      .attach("file", Buffer.from("auditor note\n"), "auditor.txt");
    assert.equal(auditorUpload.status, 403);

    const unauthenticated = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .attach("file", Buffer.from("anon\n"), "anon.txt");
    assert.equal(unauthenticated.status, 401);
  });

  it("requires a real incident and generates unique evidence codes", async () => {
    const cookie = await login("investigator2@blocktrace.local");
    const incident = await createIncident(cookie, "Evidence relation fixture");

    const first = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from("one\n"), "one.txt");
    const second = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from("two\n"), "two.txt");
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.body.evidence.evidenceCode, second.body.evidence.evidenceCode);
    createdEvidenceIds.push(first.body.evidence.id, second.body.evidence.id);

    const missing = await request(app)
      .post("/incidents/00000000-0000-4000-8000-000000000000/evidence")
      .set("Cookie", cookie)
      .attach("file", Buffer.from("missing\n"), "missing.txt");
    assert.equal(missing.status, 404);

    const malformed = await request(app)
      .post("/incidents/not-a-uuid/evidence")
      .set("Cookie", cookie)
      .attach("file", Buffer.from("bad\n"), "bad.txt");
    assert.equal(malformed.status, 400);
  });

  it("returns evidence details and lists without leaking secrets", async () => {
    const investigatorCookie = await login("investigator1@blocktrace.local");
    const incident = await createIncident(investigatorCookie, "Evidence details fixture");
    const created = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .set("Cookie", investigatorCookie)
      .attach("file", fixturePath);
    assert.equal(created.status, 201);
    createdEvidenceIds.push(created.body.evidence.id);

    for (const email of [
      "admin@blocktrace.local",
      "investigator1@blocktrace.local",
      "auditor@blocktrace.local",
    ]) {
      const cookie = await login(email);
      const details = await request(app)
        .get(`/evidence/${created.body.evidence.id}`)
        .set("Cookie", cookie);
      assert.equal(details.status, 200);
      assertSafePayload(details.body);

      const list = await request(app)
        .get(`/incidents/${incident.id}/evidence`)
        .set("Cookie", cookie);
      assert.equal(list.status, 200);
      assert.ok(list.body.evidence.some((item: { id: string }) => item.id === created.body.evidence.id));
      assertSafePayload(list.body);
    }

    const unauthenticated = await request(app).get(`/evidence/${created.body.evidence.id}`);
    assert.equal(unauthenticated.status, 401);

    const missing = await request(app)
      .get("/evidence/00000000-0000-4000-8000-000000000000")
      .set("Cookie", investigatorCookie);
    assert.equal(missing.status, 404);

    const malformed = await request(app)
      .get("/evidence/not-a-uuid")
      .set("Cookie", investigatorCookie);
    assert.equal(malformed.status, 400);
  });

  it("cleans up the stored file when persistence fails after the file is written", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const incident = await createIncident(cookie, "Evidence cleanup fixture");
    const upload = await request(app)
      .post(`/incidents/${incident.id}/evidence`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from("cleanup source\n"), "cleanup.txt");
    assert.equal(upload.status, 201);
    createdEvidenceIds.push(upload.body.evidence.id);

    const stored = await prisma.evidence.findUniqueOrThrow({
      where: { id: upload.body.evidence.id },
    });
    const sourcePath = path.join(getStorageRoot(), stored.storedFilename);
    const { copyFile } = await import("node:fs/promises");
    const tempCopy = `${sourcePath}.copy.txt`;
    await copyFile(sourcePath, tempCopy);

    let capturedPath = "";
    await assert.rejects(async () => {
      await createEvidence(
        {
          incidentId: incident.id,
          collectorId: stored.collectorId,
          originalFilename: "cleanup-fail.txt",
          storedAbsolutePath: tempCopy,
          mimeType: "text/plain",
          fileSizeBytes: 15,
          description: "forced failure",
        },
        {
          afterFileStored: async (storedAbsolutePath) => {
            capturedPath = storedAbsolutePath;
            throw new Error("forced persistence failure");
          },
        },
      );
    });

    assert.equal(capturedPath, tempCopy);
    assert.equal(await fileExists(tempCopy), false);
    const leftover = await prisma.evidence.findFirst({
      where: { originalFilename: "cleanup-fail.txt" },
    });
    assert.equal(leftover, null);
  });
});
