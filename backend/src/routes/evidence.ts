import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { handleEvidenceUpload } from "../middleware/uploadEvidence";
import { createEvidence, EvidenceValidationError, getEvidenceById, listEvidenceByIncident } from "../services/evidence";
import { getEvidenceBlockchain, registerEvidence, RegistrationHttpError } from "../services/evidenceRegistration";
import { listVerifications, verifyEvidence, VerificationHttpError } from "../services/evidenceVerification";
import { getIncidentById } from "../services/incident";
import { deleteStoredFile } from "../services/storage";
import { evidenceDescriptionSchema, evidenceIdSchema } from "../validation/evidence";
import { incidentIdSchema } from "../validation/incident";

export const evidenceRouter = Router();

evidenceRouter.post(
  "/incidents/:incidentId/evidence",
  requireAuth,
  requireRole(Role.ORG_ADMIN, Role.INVESTIGATOR),
  async (req, res, next) => {
    const parsedIncidentId = incidentIdSchema.safeParse(req.params.incidentId);
    if (!parsedIncidentId.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const incident = await getIncidentById(parsedIncidentId.data);
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    res.locals.incidentId = parsedIncidentId.data;
    next();
  },
  handleEvidenceUpload,
  async (req, res) => {
    if (!req.user) {
      if (req.file?.path) {
        await deleteStoredFile(req.file.path);
      }
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "A file is required." });
      return;
    }

    const parsedDescription = evidenceDescriptionSchema.safeParse(req.body.description);
    if (!parsedDescription.success) {
      await deleteStoredFile(req.file.path);
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    try {
      const evidence = await createEvidence({
        incidentId: res.locals.incidentId as string,
        collectorId: req.user.id,
        originalFilename: req.file.originalname,
        storedAbsolutePath: req.file.path,
        mimeType: req.file.mimetype,
        fileSizeBytes: req.file.size,
        description: parsedDescription.data,
      });
      res.status(201).json({ evidence });
    } catch (error) {
      if (error instanceof EvidenceValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }

      console.error("Create evidence failed");
      console.error(error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

evidenceRouter.get("/incidents/:incidentId/evidence", requireAuth, async (req, res) => {
  const parsedIncidentId = incidentIdSchema.safeParse(req.params.incidentId);
  if (!parsedIncidentId.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const incident = await getIncidentById(parsedIncidentId.data);
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    const evidence = await listEvidenceByIncident(parsedIncidentId.data);
    res.status(200).json({ evidence });
  } catch (error) {
    console.error("List evidence failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    res.status(500).json({ error: "Internal server error" });
  }
});

evidenceRouter.get("/evidence/:id", requireAuth, async (req, res) => {
  const parsed = evidenceIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const evidence = await getEvidenceById(parsed.data);
    if (!evidence) {
      res.status(404).json({ error: "Evidence not found" });
      return;
    }

    res.status(200).json({ evidence });
  } catch (error) {
    console.error("Get evidence failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    res.status(500).json({ error: "Internal server error" });
  }
});

evidenceRouter.post(
  "/evidence/:id/register",
  requireAuth,
  requireRole(Role.ORG_ADMIN, Role.INVESTIGATOR),
  async (req, res) => {
    const parsed = evidenceIdSchema.safeParse(req.params.id);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await registerEvidence(parsed.data, req.user.id);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof RegistrationHttpError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      console.error("Register evidence failed");
      console.error(error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

evidenceRouter.get("/evidence/:id/blockchain", requireAuth, async (req, res) => {
  const parsed = evidenceIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const blockchain = await getEvidenceBlockchain(parsed.data);
    res.status(200).json(blockchain);
  } catch (error) {
    if (error instanceof RegistrationHttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error("Get evidence blockchain failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    res.status(500).json({ error: "Internal server error" });
  }
});

evidenceRouter.post("/evidence/:id/verify", requireAuth, async (req, res) => {
  const parsed = evidenceIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = await verifyEvidence(parsed.data, req.user.id);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof VerificationHttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error("Verify evidence failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    res.status(500).json({ error: "Internal server error" });
  }
});

evidenceRouter.get("/evidence/:id/verifications", requireAuth, async (req, res) => {
  const parsed = evidenceIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const verifications = await listVerifications(parsed.data);
    res.status(200).json({ verifications });
  } catch (error) {
    if (error instanceof VerificationHttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error("List verifications failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    res.status(500).json({ error: "Internal server error" });
  }
});
