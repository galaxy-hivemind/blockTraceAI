import { Prisma, type IncidentSeverity } from "@prisma/client";
import { prisma } from "../config/prisma";
import { incidentCreatorSelect, toPublicIncident, type PublicIncident } from "../utils/publicIncident";

const MAX_CODE_ATTEMPTS = 3;

async function nextIncidentCode(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const rows = await prisma.$queryRaw<Array<{ nextval: bigint }>>`
    SELECT nextval('incident_code_seq') AS nextval
  `;
  const sequence = rows[0]?.nextval;
  if (sequence === undefined) {
    throw new Error("Failed to allocate an incident code");
  }

  return `INC-${year}-${sequence.toString().padStart(6, "0")}`;
}

export async function createIncident(input: {
  name: string;
  description: string;
  severity: IncidentSeverity;
  createdById: string;
}): Promise<PublicIncident> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const incidentCode = await nextIncidentCode();

    try {
      const incident = await prisma.incident.create({
        data: {
          incidentCode,
          name: input.name,
          description: input.description,
          severity: input.severity,
          createdById: input.createdById,
        },
        include: {
          createdBy: {
            select: incidentCreatorSelect,
          },
        },
      });

      return toPublicIncident(incident);
    } catch (error) {
      lastError = error;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to create a unique incident code");
}

export async function listIncidents(): Promise<PublicIncident[]> {
  const incidents = await prisma.incident.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: {
        select: incidentCreatorSelect,
      },
    },
  });

  return incidents.map(toPublicIncident);
}

export async function getIncidentById(id: string): Promise<PublicIncident | null> {
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      createdBy: {
        select: incidentCreatorSelect,
      },
    },
  });

  return incident ? toPublicIncident(incident) : null;
}
