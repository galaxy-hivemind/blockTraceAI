"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, type IncidentSeverity, type PublicIncident } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";

const severities: IncidentSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export default function CreateIncidentPage() {
  const router = useRouter();
  const { user, error: authError, loading } = useCurrentUser();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("HIGH");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (name.trim().length < 3) {
      setError("Name must be at least 3 characters.");
      return;
    }

    if (description.trim().length < 1) {
      setError("Description is required.");
      return;
    }

    setPending(true);

    try {
      const response = await apiFetch("/incidents", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          severity,
        }),
      });

      if (response.status === 401) {
        setError("Your session has expired. Please log in again.");
        router.replace("/");
        return;
      }

      if (response.status === 403) {
        setError("You do not have permission to create incidents.");
        return;
      }

      if (response.status === 400) {
        setError("Please check the incident details and try again.");
        return;
      }

      if (!response.ok) {
        setError("Unable to create the incident.");
        return;
      }

      const body = (await response.json()) as { incident: PublicIncident };
      router.push(`/incidents/${body.incident.id}`);
    } catch {
      setError("Unable to reach the backend");
    } finally {
      setPending(false);
    }
  }

  if (loading || (!user && !authError)) {
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
      <div className="mx-auto max-w-xl">
        <Link className="text-sm text-zinc-400 underline" href="/incidents">
          Back to incidents
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Create Incident</h1>
        <p className="mt-2 text-sm text-zinc-400">
          The backend assigns the incident code, status, and creator.
        </p>

        {user?.role === "AUDITOR" ? (
          <p className="mt-6 text-red-400">You do not have permission to create incidents.</p>
        ) : (
          <form className="mt-8 space-y-4" onSubmit={onSubmit}>
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">Name</span>
              <input
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-zinc-500"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                required
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">Description</span>
              <textarea
                className="min-h-32 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-zinc-500"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={5000}
                required
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">Severity</span>
              <select
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-zinc-500"
                value={severity}
                onChange={(event) => setSeverity(event.target.value as IncidentSeverity)}
              >
                {severities.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            <button
              className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
              type="submit"
              disabled={pending}
            >
              {pending ? "Creating..." : "Create Incident"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
