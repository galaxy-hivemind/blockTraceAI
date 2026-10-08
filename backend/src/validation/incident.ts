import { z } from "zod";

export const incidentSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const createIncidentSchema = z
  .object({
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().min(1).max(5000),
    severity: incidentSeveritySchema,
  })
  .strict();

export const incidentIdSchema = z.string().uuid();
