import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config/env";
import { prisma } from "../config/prisma";

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function readSessionToken(req: Request): string | undefined {
  const signed = req.signedCookies?.[config.sessionCookieName];
  if (typeof signed === "string" && signed.length > 0) {
    return signed;
  }

  const unsigned = req.cookies?.[config.sessionCookieName];
  return typeof unsigned === "string" && unsigned.length > 0 ? unsigned : undefined;
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(config.sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    signed: true,
    path: "/",
    maxAge: config.sessionDurationMs,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    signed: true,
    path: "/",
  });
}

export async function createSession(userId: string) {
  const id = createSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionDurationMs);

  return prisma.session.create({
    data: {
      id,
      userId,
      expiresAt,
    },
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { id: sessionId },
  });
}
