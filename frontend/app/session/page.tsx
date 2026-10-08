"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, type PublicUser } from "@/lib/api";

export default function SessionPage() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      const response = await apiFetch("/auth/me");
      if (cancelled) {
        return;
      }

      if (!response.ok) {
        router.replace("/");
        return;
      }

      const body = (await response.json()) as { user: PublicUser };
      setUser(body.user);
    }

    loadUser().catch(() => {
      if (!cancelled) {
        setError("Unable to load the current session");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onLogout() {
    await apiFetch("/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-red-400">
        {error}
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Checking session...
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 text-zinc-50">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        <h1 className="text-3xl font-semibold tracking-tight">BlockTrace</h1>
        <p className="mt-6 text-lg">Welcome, {user.fullName}</p>
        <p className="mt-2 text-sm text-zinc-400">{user.email}</p>
        <p className="mt-1 text-sm text-zinc-300">Role: {user.role}</p>
        <Link
          className="mt-6 block w-full rounded-md border border-zinc-700 px-3 py-2 text-center text-sm text-zinc-100"
          href="/incidents"
        >
          Open Incidents
        </Link>
        <button
          className="mt-3 w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950"
          type="button"
          onClick={() => {
            void onLogout();
          }}
        >
          Logout
        </button>
      </div>
    </main>
  );
}
