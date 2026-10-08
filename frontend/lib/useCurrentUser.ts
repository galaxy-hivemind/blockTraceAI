"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, type PublicUser } from "@/lib/api";

export function useCurrentUser() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        const response = await apiFetch("/auth/me");
        if (cancelled) {
          return;
        }

        if (response.status === 401) {
          setError("Your session has expired. Please log in again.");
          router.replace("/");
          return;
        }

        if (!response.ok) {
          setError("Unable to load the current session");
          return;
        }

        const body = (await response.json()) as { user: PublicUser };
        setUser(body.user);
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

    void loadUser();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return { user, error, loading };
}
