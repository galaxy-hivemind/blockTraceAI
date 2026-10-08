"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, apiUpload, type PublicEvidence, type PublicIncident } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";

const allowedExtensions = [".txt", ".log", ".json", ".csv", ".pdf", ".png", ".jpg", ".zip"];
const maxBytes = 10 * 1024 * 1024;

export default function UploadEvidencePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, error: authError, loading } = useCurrentUser();
  const [incident, setIncident] = useState<PublicIncident | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!user || !params.id) {
      return;
    }

    let cancelled = false;

    async function loadIncident() {
      const response = await apiFetch(`/incidents/${params.id}`);
      if (cancelled) {
        return;
      }

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      if (!response.ok) {
        setError("Unable to load the incident.");
        return;
      }

      const body = (await response.json()) as { incident: PublicIncident };
      setIncident(body.incident);
    }

    void loadIncident();
    return () => {
      cancelled = true;
    };
  }, [params.id, router, user]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError("A file is required.");
      return;
    }

    const extension = file.name.includes(".") ? `.${file.name.split(".").pop()?.toLowerCase()}` : "";
    if (!allowedExtensions.includes(extension)) {
      setError("Unsupported file type.");
      return;
    }

    if (file.size > maxBytes) {
      setError("File exceeds the 10 MB limit.");
      return;
    }

    setPending(true);
    const formData = new FormData();
    formData.append("file", file);
    if (description.trim()) {
      formData.append("description", description.trim());
    }

    try {
      const response = await apiUpload(`/incidents/${params.id}/evidence`, formData);
      if (response.status === 401) {
        setError("Your session has expired. Please log in again.");
        router.replace("/");
        return;
      }
      if (response.status === 403) {
        setError("You do not have permission to upload evidence.");
        return;
      }
      if (response.status === 413) {
        setError("File exceeds the 10 MB limit.");
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Unable to upload evidence.");
        return;
      }

      const body = (await response.json()) as { evidence: PublicEvidence };
      router.push(`/evidence/${body.evidence.id}`);
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

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-50">
      <div className="mx-auto max-w-xl">
        <Link className="text-sm text-zinc-400 underline" href={`/incidents/${params.id}`}>
          Back to incident
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Upload Evidence</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Incident: {incident ? incident.incidentCode : "Loading..."}
        </p>

        {user?.role === "AUDITOR" ? (
          <p className="mt-6 text-red-400">You do not have permission to upload evidence.</p>
        ) : (
          <form className="mt-8 space-y-4" onSubmit={onSubmit}>
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">File</span>
              <input
                className="w-full text-sm"
                type="file"
                accept=".txt,.log,.json,.csv,.pdf,.png,.jpg,.zip"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                required
              />
            </label>

            {file ? (
              <p className="text-sm text-zinc-400">
                {file.name} · {(file.size / 1024).toFixed(1)} KB · {file.type || "unknown type"}
              </p>
            ) : null}

            <label className="block text-sm">
              <span className="mb-1 block text-zinc-300">Description</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-zinc-500"
                value={description}
                maxLength={2000}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            <button
              className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
              type="submit"
              disabled={pending}
            >
              {pending ? "Uploading..." : "Upload Evidence"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
