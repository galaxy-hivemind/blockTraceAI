import type { Incident, IncidentSeverity, IncidentStatus, Role } from "@prisma/client";

export type IncidentCreator = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
};

export type PublicIncident = {
  id: string;
  incidentCode: string;
  name: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdBy: IncidentCreator;
  createdAt: Date;
  updatedAt: Date;
};

export const incidentCreatorSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
} as const;

export function toPublicIncident(
  incident: Incident & { createdBy: IncidentCreator },
): PublicIncident {
  return {
    id: incident.id,
    incidentCode: incident.incidentCode,
    name: incident.name,
    description: incident.description,
    severity: incident.severity,
    status: incident.status,
    createdBy: incident.createdBy,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
  };
}
