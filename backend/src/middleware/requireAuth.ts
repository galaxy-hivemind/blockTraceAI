import { UserStatus } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { readSessionToken } from "../services/session";
import { toPublicUser } from "../utils/publicUser";

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = readSessionToken(req);
    if (!sessionId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) {
        await prisma.session.deleteMany({ where: { id: session.id } });
      }
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (session.user.status !== UserStatus.ACTIVE) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    req.user = toPublicUser(session.user);
    next();
  } catch (error) {
    console.error("Authentication middleware failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    res.status(401).json({ error: "Unauthorized" });
  }
}
