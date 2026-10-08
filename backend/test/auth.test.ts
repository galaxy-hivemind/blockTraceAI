import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Role, UserStatus } from "@prisma/client";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/services/password";

const app = createApp();
const testPassword = "TestPassw0rd!";
const seededEmails = [
  "admin@blocktrace.local",
  "investigator1@blocktrace.local",
  "investigator2@blocktrace.local",
  "auditor@blocktrace.local",
] as const;

function cookieValue(headers: request.Response["headers"], name: string): string | undefined {
  const raw = headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match;
}

function sessionCookieHeader(setCookieHeader: string): string {
  const firstPair = setCookieHeader.split(";")[0];
  return firstPair;
}

describe("BlockTrace authentication", () => {
  const suffix = randomUUID();
  const activeEmail = `test-active-${suffix}@blocktrace.test`;
  const disabledEmail = `test-disabled-${suffix}@blocktrace.test`;
  const createdEmails = [activeEmail, disabledEmail];

  before(async () => {
    const passwordHash = await hashPassword(testPassword);

    await prisma.user.create({
      data: {
        email: activeEmail,
        passwordHash,
        fullName: "Test Active User",
        role: Role.INVESTIGATOR,
        status: UserStatus.ACTIVE,
      },
    });

    await prisma.user.create({
      data: {
        email: disabledEmail,
        passwordHash,
        fullName: "Test Disabled User",
        role: Role.AUDITOR,
        status: UserStatus.DISABLED,
      },
    });
  });

  after(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: createdEmails } },
    });
    await prisma.$disconnect();
  });

  it("seeds the four MVP users with hashed passwords", async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: [...seededEmails] } },
      orderBy: { email: "asc" },
    });

    assert.equal(users.length, 4);
    assert.equal(users.find((user) => user.email === "admin@blocktrace.local")?.role, Role.ORG_ADMIN);
    assert.equal(users.find((user) => user.email === "investigator1@blocktrace.local")?.role, Role.INVESTIGATOR);
    assert.equal(
      users.find((user) => user.email === "investigator1@blocktrace.local")?.walletAddress,
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    );
    assert.equal(users.find((user) => user.email === "investigator2@blocktrace.local")?.role, Role.INVESTIGATOR);
    assert.equal(
      users.find((user) => user.email === "investigator2@blocktrace.local")?.walletAddress,
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    );
    assert.equal(users.find((user) => user.email === "auditor@blocktrace.local")?.role, Role.AUDITOR);
    assert.equal(users.find((user) => user.email === "auditor@blocktrace.local")?.walletAddress, null);
    assert.equal(users.find((user) => user.email === "admin@blocktrace.local")?.walletAddress, null);

    for (const user of users) {
      assert.equal(user.status, UserStatus.ACTIVE);
      assert.match(user.passwordHash, /^\$argon2id\$/);
      assert.doesNotMatch(user.passwordHash, /BlockTraceDev!2026/);
    }
  });

  it("logs in with valid credentials and sets an HTTP-only session cookie", async () => {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: activeEmail, password: testPassword });

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, activeEmail);
    assert.equal(response.body.user.role, Role.INVESTIGATOR);
    assert.equal(response.body.user.passwordHash, undefined);
    assert.equal(response.body.user.password, undefined);
    assert.equal(response.body.sessionId, undefined);

    const cookie = cookieValue(response.headers, "blocktrace_session");
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/i);
    assert.doesNotMatch(cookie, /blocktrace_session=; /);
  });

  it("rejects a wrong password and an unknown email with the same 401", async () => {
    const wrongPassword = await request(app)
      .post("/auth/login")
      .send({ email: activeEmail, password: "WrongPassw0rd!" });
    const unknownEmail = await request(app)
      .post("/auth/login")
      .send({ email: `missing-${suffix}@blocktrace.test`, password: testPassword });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.body.error, unknownEmail.body.error);
  });

  it("rejects a disabled user even with the correct password", async () => {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: disabledEmail, password: testPassword });

    assert.equal(response.status, 401);
    assert.equal(response.body.error, "Invalid credentials");
  });

  it("rejects a malformed login request", async () => {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: "not-an-email", password: "" });

    assert.equal(response.status, 400);
  });

  it("returns the current user for an authenticated session", async () => {
    const login = await request(app)
      .post("/auth/login")
      .send({ email: activeEmail, password: testPassword });
    const cookie = cookieValue(login.headers, "blocktrace_session");
    assert.ok(cookie);

    const me = await request(app)
      .get("/auth/me")
      .set("Cookie", sessionCookieHeader(cookie));

    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, activeEmail);
    assert.equal(me.body.user.passwordHash, undefined);
  });

  it("returns 401 when no session cookie is present", async () => {
    const response = await request(app).get("/auth/me");
    assert.equal(response.status, 401);
  });

  it("returns 401 for an expired session", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: activeEmail } });
    await prisma.session.create({
      data: {
        id: `expired-${suffix}`,
        userId: user.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const response = await request(app)
      .get("/auth/me")
      .set("Cookie", `blocktrace_session=expired-${suffix}`);

    assert.equal(response.status, 401);
  });

  it("invalidates the session on logout", async () => {
    const login = await request(app)
      .post("/auth/login")
      .send({ email: activeEmail, password: testPassword });
    const cookie = cookieValue(login.headers, "blocktrace_session");
    assert.ok(cookie);

    const logout = await request(app)
      .post("/auth/logout")
      .set("Cookie", sessionCookieHeader(cookie));
    assert.equal(logout.status, 200);

    const me = await request(app)
      .get("/auth/me")
      .set("Cookie", sessionCookieHeader(cookie));
    assert.equal(me.status, 401);
  });

  it("distinguishes 401 and 403 on protected RBAC routes", async () => {
    const unauthenticated = await request(app).get("/protected/admin");
    assert.equal(unauthenticated.status, 401);

    const investigatorLogin = await request(app)
      .post("/auth/login")
      .send({ email: "investigator1@blocktrace.local", password: "BlockTraceDev!2026" });
    const investigatorCookie = cookieValue(investigatorLogin.headers, "blocktrace_session");
    assert.ok(investigatorCookie);

    const investigatorForbidden = await request(app)
      .get("/protected/admin")
      .set("Cookie", sessionCookieHeader(investigatorCookie));
    assert.equal(investigatorForbidden.status, 403);

    const investigatorAllowed = await request(app)
      .get("/protected/investigator")
      .set("Cookie", sessionCookieHeader(investigatorCookie));
    assert.equal(investigatorAllowed.status, 200);

    const adminLogin = await request(app)
      .post("/auth/login")
      .send({ email: "admin@blocktrace.local", password: "BlockTraceDev!2026" });
    const adminCookie = cookieValue(adminLogin.headers, "blocktrace_session");
    assert.ok(adminCookie);

    const adminAllowed = await request(app)
      .get("/protected/admin")
      .set("Cookie", sessionCookieHeader(adminCookie));
    assert.equal(adminAllowed.status, 200);

    const auditorLogin = await request(app)
      .post("/auth/login")
      .send({ email: "auditor@blocktrace.local", password: "BlockTraceDev!2026" });
    const auditorCookie = cookieValue(auditorLogin.headers, "blocktrace_session");
    assert.ok(auditorCookie);

    const auditorAllowed = await request(app)
      .get("/protected/auditor")
      .set("Cookie", sessionCookieHeader(auditorCookie));
    assert.equal(auditorAllowed.status, 200);

    const auditorForbidden = await request(app)
      .get("/protected/investigator")
      .set("Cookie", sessionCookieHeader(auditorCookie));
    assert.equal(auditorForbidden.status, 403);
  });
});
