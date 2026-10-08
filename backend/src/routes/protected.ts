import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

export const protectedRouter = Router();

// Authentication/RBAC demonstration routes only. These are not business APIs.
protectedRouter.get("/protected", requireAuth, (req, res) => {
  res.status(200).json({
    message: "Authenticated",
    user: req.user,
  });
});

protectedRouter.get(
  "/protected/admin",
  requireAuth,
  requireRole(Role.ORG_ADMIN),
  (req, res) => {
    res.status(200).json({
      message: "ORG_ADMIN access granted",
      user: req.user,
    });
  },
);

protectedRouter.get(
  "/protected/investigator",
  requireAuth,
  requireRole(Role.INVESTIGATOR),
  (req, res) => {
    res.status(200).json({
      message: "INVESTIGATOR access granted",
      user: req.user,
    });
  },
);

protectedRouter.get(
  "/protected/auditor",
  requireAuth,
  requireRole(Role.AUDITOR),
  (req, res) => {
    res.status(200).json({
      message: "AUDITOR access granted",
      user: req.user,
    });
  },
);
