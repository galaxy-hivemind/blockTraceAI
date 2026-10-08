import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";

const app = createApp();
const seedPassword = "BlockTraceDev!2026";
const createdIncidentIds: string[] = [];

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

function assertNoPasswordHash(body: unknown): void {
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /passwordHash/);
  assert.doesNotMatch(serialized, /"password":/);
}

describe("BlockTrace incidents", () => {
  after(async () => {
    if (createdIncidentIds.length > 0) {
      await prisma.incident.deleteMany({
        where: { id: { in: createdIncidentIds } },
      });
    }
  });

  it("lets an investigator create an incident persisted in PostgreSQL", async () => {
    const cookie = await login("investigator1@blocktrace.local");
    const response = await request(app)
      .post("/incidents")
      .set("Cookie", cookie)
      .send({
        name: "Ransomware Attack - Server-01",
        description: "Suspected ransomware activity detected on production server.",
        severity: "HIGH",
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.incident.status, "OPEN");
    assert.equal(response.body.incident.severity, "HIGH");
    assert.match(response.body.incident.incidentCode, /^INC-\d{4}-\d{6}$/);
    assert.equal(response.body.incident.createdBy.email, "investigator1@blocktrace.local");
    assertNoPasswordHash(response.body);
    createdIncidentIds.push(response.body.incident.id);

    const stored = await prisma.incident.findUnique({
      where: { id: response.body.incident.id },
    });
    assert.ok(stored);
    assert.equal(stored.status, "OPEN");
    assert.equal(stored.createdById, response.body.incident.createdBy.id);
  });

  it("lets an organization admin create an incident", async () => {
    const cookie = await login("admin@blocktrace.local");
    const response = await request(app)
      .post("/incidents")
      .set("Cookie", cookie)
      .send({
        name: "Admin created incident",
        description: "Created by the organization administrator.",
        severity: "MEDIUM",
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.incident.createdBy.role, "ORG_ADMIN");
    createdIncidentIds.push(response.body.incident.id);
  });

  it("forbids auditors from creating incidents", async () => {
    const cookie = await login("auditor@blocktrace.local");
    const response = await request(app)
      .post("/incidents")
      .set("Cookie", cookie)
      .send({
        name: "Auditor should not create this",
        description: "Auditors are read-only in Phase 3.",
        severity: "LOW",
      });

    assert.equal(response.status, 403);
  });

  it("rejects unauthenticated incident creation", async () => {
    const response = await request(app).post("/incidents").send({
      name: "Unauthenticated incident",
      description: "Should not be created.",
      severity: "LOW",
    });

    assert.equal(response.status, 401);
  });

  it("generates unique incident codes", async () => {
    const cookie = await login("investigator2@blocktrace.local");
    const first = await request(app)
      .post("/incidents")
      .set("Cookie", cookie)
      .send({
        name: "First uniqueness incident",
        description: "Used to compare generated codes.",
        severity: "LOW",
      });
    const second = await request(app)
      .post("/incidents")
      .set("Cookie", cookie)
      .send({
        name: "Second uniqueness incident",
        description: "Used to compare generated codes.",
        severity: "LOW",
      });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.body.incident.incidentCode, second.body.incident.incidentCode);
    createdIncidentIds.push(first.body.incident.id, second.body.incident.id);
  });

  it("rejects invalid create payloads", async () => {
    const cookie = await login("investigator1@blocktrace.local");

    const invalidSeverity = await request(app)
      .post("/incidents")
      .set("Cookie", cookie)
      .send({
        name: "Bad severity",
        description: "Invalid enum value.",
        severity: "EXTREME",
      });
    const missingName = await request(app)
      .post("/incidents")
      .set("Cookie", cookie)
      .send({
        description: "Missing name.",
        severity: "LOW",
      });
    const missingDescription = await request(app)
      .post("/incidents")
      .set("Cookie", cookie)
      .send({
        name: "Missing description",
        severity: "LOW",
      });
    const tooLong = await request(app)
      .post("/incidents")
      .set("Cookie", cookie)
      .send({
        name: "x".repeat(201),
        description: "Too long name.",
        severity: "LOW",
      });

    assert.equal(invalidSeverity.status, 400);
    assert.equal(missingName.status, 400);
    assert.equal(missingDescription.status, 400);
    assert.equal(tooLong.status, 400);
  });

  it("lists incidents for every authenticated role and rejects unauthenticated access", async () => {
    const investigatorCookie = await login("investigator1@blocktrace.local");
    const created = await request(app)
      .post("/incidents")
      .set("Cookie", investigatorCookie)
      .send({
        name: "List fixture incident",
        description: "Should appear in list results.",
        severity: "CRITICAL",
      });
    assert.equal(created.status, 201);
    createdIncidentIds.push(created.body.incident.id);

    for (const email of [
      "admin@blocktrace.local",
      "investigator1@blocktrace.local",
      "auditor@blocktrace.local",
    ]) {
      const cookie = await login(email);
      const response = await request(app).get("/incidents").set("Cookie", cookie);
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(response.body.incidents));
      assert.ok(response.body.incidents.some((incident: { id: string }) => incident.id === created.body.incident.id));
      assertNoPasswordHash(response.body);

      const createdAtValues = response.body.incidents.map((incident: { createdAt: string }) =>
        new Date(incident.createdAt).getTime(),
      );
      const sorted = [...createdAtValues].sort((left, right) => right - left);
      assert.deepEqual(createdAtValues, sorted);
    }

    const unauthenticated = await request(app).get("/incidents");
    assert.equal(unauthenticated.status, 401);
  });

  it("returns incident details with 400/404 for invalid identifiers", async () => {
    const investigatorCookie = await login("investigator1@blocktrace.local");
    const created = await request(app)
      .post("/incidents")
      .set("Cookie", investigatorCookie)
      .send({
        name: "Details fixture incident",
        description: "Used for details endpoint tests.",
        severity: "HIGH",
      });
    assert.equal(created.status, 201);
    createdIncidentIds.push(created.body.incident.id);

    for (const email of [
      "admin@blocktrace.local",
      "investigator1@blocktrace.local",
      "auditor@blocktrace.local",
    ]) {
      const cookie = await login(email);
      const response = await request(app)
        .get(`/incidents/${created.body.incident.id}`)
        .set("Cookie", cookie);
      assert.equal(response.status, 200);
      assert.equal(response.body.incident.id, created.body.incident.id);
      assert.equal(response.body.incident.name, "Details fixture incident");
      assertNoPasswordHash(response.body);
    }

    const unauthenticated = await request(app).get(`/incidents/${created.body.incident.id}`);
    assert.equal(unauthenticated.status, 401);

    const missing = await request(app)
      .get("/incidents/00000000-0000-4000-8000-000000000000")
      .set("Cookie", investigatorCookie);
    assert.equal(missing.status, 404);

    const malformed = await request(app)
      .get("/incidents/not-a-uuid")
      .set("Cookie", investigatorCookie);
    assert.equal(malformed.status, 400);
  });
});
