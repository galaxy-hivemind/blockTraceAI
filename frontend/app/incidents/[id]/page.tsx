"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, type PublicEvidence, type PublicIncident } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";

export default function IncidentDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, error: authError, loading: authLoading } = useCurrentUser();
  const [incident, setIncident] = useState<PublicIncident | null>(null);
  const [evidence, setEvidence] = useState<PublicEvidence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !params.id) {
      return;
    }

    let cancelled = false;

    async function loadIncident() {
      try {
        const response = await apiFetch(`/incidents/${params.id}`);
        if (cancelled) {
          return;
        }

        if (response.status === 401) {
          setError("Your session has expired. Please log in again.");
          router.replace("/");
          return;
        }

        if (response.status === 404) {
          setError("Incident not found.");
          return;
        }

        if (response.status === 400) {
          setError("Incident not found.");
          return;
        }

        if (!response.ok) {
          setError("Unable to load the incident.");
          return;
        }

        const body = (await response.json()) as { incident: PublicIncident };
        setIncident(body.incident);

        const evidenceResponse = await apiFetch(`/incidents/${params.id}/evidence`);
        if (cancelled) {
          return;
        }
        if (evidenceResponse.ok) {
          const evidenceBody = (await evidenceResponse.json()) as { evidence: PublicEvidence[] };
          setEvidence(evidenceBody.evidence);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to reach the backend");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadIncident();

    return () => {
      cancelled = true;
    };
  }, [params.id, router, user]);

  if (authLoading || (!user && !authError)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Checking session...
      </main>
    );
  }

  if (authError && !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-red-400">
        {authError}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-50">
      <div className="mx-auto max-w-3xl">
        <Link className="text-sm text-zinc-400 underline" href="/incidents">
          Back to incidents
        </Link>

        {loading ? <p className="mt-10 text-zinc-400">Loading incident...</p> : null}
        {error ? <p className="mt-10 text-red-400">{error}</p> : null}

        {incident ? (
          <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-8">
            <p className="text-sm text-zinc-400">{incident.incidentCode}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{incident.name}</h1>
            <p className="mt-4 whitespace-pre-wrap text-zinc-200">{incident.description}</p>
            <dl className="mt-8 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-400">Severity</dt>
                <dd className="mt-1">{incident.severity}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Status</dt>
                <dd className="mt-1">{incident.status}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Created By</dt>
                <dd className="mt-1">
                  {incident.createdBy.fullName} ({incident.createdBy.email})
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Created At</dt>
                <dd className="mt-1">{new Date(incident.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Updated At</dt>
                <dd className="mt-1">{new Date(incident.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="mt-8 rounded-xl border border-zinc-800 p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-medium">Evidence</h2>
            {user?.role === "ORG_ADMIN" || user?.role === "INVESTIGATOR" ? (
              <Link
                className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950"
                href={`/incidents/${params.id}/evidence/new`}
              >
                Upload Evidence
              </Link>
            ) : null}
          </div>

          {evidence.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">No evidence has been attached yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-zinc-400">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Evidence Code</th>
                    <th className="py-2 pr-4 font-medium">Filename</th>
                    <th className="py-2 pr-4 font-medium">Size</th>
                    <th className="py-2 pr-4 font-medium">SHA-256</th>
                    <th className="py-2 pr-4 font-medium">Integrity</th>
                    <th className="py-2 pr-4 font-medium">Blockchain</th>
                    <th className="py-2 pr-4 font-medium">Storage</th>
                    <th className="py-2 pr-4 font-medium">Collector</th>
                    <th className="py-2 font-medium">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.map((item) => (
                    <tr key={item.id} className="border-t border-zinc-800">
                      <td className="py-2 pr-4">
                        <Link className="underline" href={`/evidence/${item.id}`}>
                          {item.evidenceCode}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{item.originalFilename}</td>
                      <td className="py-2 pr-4">{item.fileSizeBytes}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{item.sha256HashCached.slice(0, 12)}...</td>
                      <td className="py-2 pr-4">{item.integrityStatus}</td>
                      <td className="py-2 pr-4">{item.blockchainRegistrationStatus.replaceAll("_", " ")}</td>
                      <td className="py-2 pr-4">{item.storageStatus}</td>
                      <td className="py-2 pr-4">{item.collector.fullName}</td>
                      <td className="py-2">{new Date(item.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
