import { UserStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { toPublicUser } from "../utils/publicUser";
import { hashPassword, verifyPassword } from "./password";
import { createSession } from "./session";

export const INVALID_CREDENTIALS = "Invalid credentials";

let dummyPasswordHash: Promise<string> | undefined;

async function verifyAgainstDummyHash(password: string): Promise<void> {
  dummyPasswordHash ??= hashPassword("not-a-real-user-password");
  await verifyPassword(password, await dummyPasswordHash);
}

export async function authenticateUser(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || user.status !== UserStatus.ACTIVE) {
    if (user) {
      await verifyPassword(password, user.passwordHash);
    } else {
      await verifyAgainstDummyHash(password);
    }
    return { ok: false as const, error: INVALID_CREDENTIALS };
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    return { ok: false as const, error: INVALID_CREDENTIALS };
  }

  const session = await createSession(user.id);
  return {
    ok: true as const,
    user: toPublicUser(user),
    sessionId: session.id,
  };
}
