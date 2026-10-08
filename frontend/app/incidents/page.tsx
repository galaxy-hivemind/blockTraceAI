"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, type PublicIncident } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";

export default function IncidentsPage() {
  const router = useRouter();
  const { user, error: authError, loading: authLoading } = useCurrentUser();
  const [incidents, setIncidents] = useState<PublicIncident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    async function loadIncidents() {
      try {
        const response = await apiFetch("/incidents");
        if (cancelled) {
          return;
        }

        if (response.status === 401) {
          setError("Your session has expired. Please log in again.");
          router.replace("/");
          return;
        }

        if (!response.ok) {
          setError("Unable to load incidents");
          return;
        }

        const body = (await response.json()) as { incidents: PublicIncident[] };
        setIncidents(body.incidents);
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

    void loadIncidents();

    return () => {
      cancelled = true;
    };
  }, [router, user]);

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

  const canCreate = user?.role === "ORG_ADMIN" || user?.role === "INVESTIGATOR";

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-50">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Incidents</h1>
            <p className="mt-2 text-sm text-zinc-400">Cyber investigation cases stored in PostgreSQL.</p>
          </div>
          <div className="flex gap-3">
            <Link className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200" href="/session">
              Account
            </Link>
            {canCreate ? (
              <Link className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950" href="/incidents/new">
                + Create Incident
              </Link>
            ) : null}
          </div>
        </div>

        {loading ? <p className="mt-10 text-zinc-400">Loading incidents...</p> : null}
        {error ? <p className="mt-10 text-red-400">{error}</p> : null}
        {!loading && !error && incidents.length === 0 ? (
          <p className="mt-10 text-zinc-400">No incidents found.</p>
        ) : null}

        {!loading && !error && incidents.length > 0 ? (
          <div className="mt-8 overflow-x-auto rounded-xl border border-zinc-800">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Incident Code</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Severity</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created By</th>
                  <th className="px-4 py-3 font-medium">Created At</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <tr key={incident.id} className="border-t border-zinc-800">
                    <td className="px-4 py-3">
                      <Link className="text-zinc-100 underline" href={`/incidents/${incident.id}`}>
                        {incident.incidentCode}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{incident.name}</td>
                    <td className="px-4 py-3">{incident.severity}</td>
                    <td className="px-4 py-3">{incident.status}</td>
                    <td className="px-4 py-3">{incident.createdBy.fullName}</td>
                    <td className="px-4 py-3">{new Date(incident.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </main>
  );
}
