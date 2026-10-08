import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { authenticateUser } from "../services/auth";
import { clearSessionCookie, deleteSession, readSessionToken, setSessionCookie } from "../services/session";
import { loginSchema } from "../validation/auth";

export const authRouter = Router();

authRouter.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const result = await authenticateUser(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }

    setSessionCookie(res, result.sessionId);
    res.status(200).json({ user: result.user });
  } catch (error) {
    console.error("Login failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    res.status(500).json({ error: "Internal server error" });
  }
});

authRouter.post("/auth/logout", async (req, res) => {
  try {
    const sessionId = readSessionToken(req);
    if (sessionId) {
      await deleteSession(sessionId);
    }
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Logout failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
  }
});

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.status(200).json({ user: req.user });
});
