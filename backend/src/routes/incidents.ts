import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { createIncident, getIncidentById, listIncidents } from "../services/incident";
import { createIncidentSchema, incidentIdSchema } from "../validation/incident";

export const incidentsRouter = Router();

incidentsRouter.post(
  "/incidents",
  requireAuth,
  requireRole(Role.ORG_ADMIN, Role.INVESTIGATOR),
  async (req, res) => {
    const parsed = createIncidentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const incident = await createIncident({
        ...parsed.data,
        createdById: req.user.id,
      });
      res.status(201).json({ incident });
    } catch (error) {
      console.error("Create incident failed");
      console.error(error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

incidentsRouter.get("/incidents", requireAuth, async (_req, res) => {
  try {
    const incidents = await listIncidents();
    res.status(200).json({ incidents });
  } catch (error) {
    console.error("List incidents failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    res.status(500).json({ error: "Internal server error" });
  }
});

incidentsRouter.get("/incidents/:id", requireAuth, async (req, res) => {
  const parsed = incidentIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const incident = await getIncidentById(parsed.data);
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    res.status(200).json({ incident });
  } catch (error) {
    console.error("Get incident failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    res.status(500).json({ error: "Internal server error" });
  }
});
