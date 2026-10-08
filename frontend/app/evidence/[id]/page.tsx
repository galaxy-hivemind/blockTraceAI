"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  apiFetch,
  getEvidenceBlockchain,
  getEvidenceVerifications,
  registerEvidence,
  verifyEvidence,
  type EvidenceBlockchain,
  type PublicEvidence,
  type PublicVerification,
} from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";

export default function EvidenceDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, error: authError, loading: authLoading } = useCurrentUser();
  const [evidence, setEvidence] = useState<PublicEvidence | null>(null);
  const [blockchain, setBlockchain] = useState<EvidenceBlockchain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [latestVerification, setLatestVerification] = useState<PublicVerification | null>(null);
  const [history, setHistory] = useState<PublicVerification[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !params.id) {
      return;
    }

    let cancelled = false;

    async function loadEvidence() {
      try {
        const response = await apiFetch(`/evidence/${params.id}`);
        if (cancelled) {
          return;
        }

        if (response.status === 401) {
          setError("Your session has expired. Please log in again.");
          router.replace("/");
          return;
        }

        if (response.status === 404 || response.status === 400) {
          setError("Evidence not found.");
          return;
        }

        if (!response.ok) {
          setError("Unable to load the evidence.");
          return;
        }

        const body = (await response.json()) as { evidence: PublicEvidence };
        setEvidence(body.evidence);

        const chainResponse = await getEvidenceBlockchain(params.id);
        if (!cancelled && chainResponse.ok) {
          setBlockchain((await chainResponse.json()) as EvidenceBlockchain);
        }

        const historyResponse = await getEvidenceVerifications(params.id);
        if (!cancelled && historyResponse.ok) {
          const historyBody = (await historyResponse.json()) as { verifications: PublicVerification[] };
          setHistory(historyBody.verifications);
          setLatestVerification(historyBody.verifications[0] ?? null);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to reach the backend");
        }
      }
    }

    void loadEvidence();
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

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-50">
      <div className="mx-auto max-w-3xl">
        {evidence ? (
          <Link className="text-sm text-zinc-400 underline" href={`/incidents/${evidence.incidentId}`}>
            Back to incident
          </Link>
        ) : (
          <Link className="text-sm text-zinc-400 underline" href="/incidents">
            Back to incidents
          </Link>
        )}

        {error ? <p className="mt-10 text-red-400">{error}</p> : null}
        {!evidence && !error ? <p className="mt-10 text-zinc-400">Loading evidence...</p> : null}

        {evidence ? (
          <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-8">
            <p className="text-sm text-zinc-400">{evidence.evidenceCode}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{evidence.originalFilename}</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Incident{" "}
              <Link className="underline" href={`/incidents/${evidence.incident.id}`}>
                {evidence.incident.incidentCode}
              </Link>
            </p>

            <dl className="mt-8 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-zinc-400">Evidence ID</dt>
                <dd className="mt-1 break-all">{evidence.id}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">File Size</dt>
                <dd className="mt-1">{evidence.fileSizeBytes} bytes</dd>
              </div>
              <div>
                <dt className="text-zinc-400">MIME Type</dt>
                <dd className="mt-1">{evidence.mimeType}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Hash Algorithm</dt>
                <dd className="mt-1">{evidence.hashAlgorithm}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Collector</dt>
                <dd className="mt-1">
                  {evidence.collector.fullName} ({evidence.collector.email})
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Current Custodian</dt>
                <dd className="mt-1">
                  {evidence.currentCustodian
                    ? `${evidence.currentCustodian.fullName} (${evidence.currentCustodian.email})`
                    : "Unassigned"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Storage Status</dt>
                <dd className="mt-1">{evidence.storageStatus}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Integrity Status</dt>
                <dd className="mt-1">{evidence.integrityStatus}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Created At</dt>
                <dd className="mt-1">{new Date(evidence.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Updated At</dt>
                <dd className="mt-1">{new Date(evidence.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>

            <div className="mt-8">
              <p className="text-sm text-zinc-400">Cached SHA-256</p>
              <div className="mt-2 flex items-center gap-3">
                <code className="break-all rounded-md bg-zinc-950 px-3 py-2 font-mono text-xs text-emerald-300">
                  {evidence.sha256HashCached}
                </code>
                <button
                  className="rounded-md border border-zinc-700 px-3 py-2 text-xs"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(evidence.sha256HashCached);
                    setCopied("cached");
                  }}
                >
                  {copied === "cached" ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                Cached SHA-256 calculated at upload. Registration records this value on the local
                blockchain. Registration is not integrity verification.
              </p>
            </div>

            <IntegrityPanel
              evidence={evidence}
              registered={blockchain?.registered === true}
              latest={latestVerification}
              history={history}
              verifying={verifying}
              verifyError={verifyError}
              copied={copied}
              onCopy={(value, key) => {
                void navigator.clipboard.writeText(value);
                setCopied(key);
              }}
              onVerify={async () => {
                setVerifyError(null);
                setVerifying(true);
                try {
                  const response = await verifyEvidence(evidence.id);
                  const body = (await response.json()) as {
                    error?: string;
                    evidence?: PublicEvidence;
                    verification?: PublicVerification;
                  };

                  if (!response.ok) {
                    setVerifyError(body.error ?? "Verification failed");
                    if (response.status === 409) {
                      const refresh = await apiFetch(`/evidence/${evidence.id}`);
                      if (refresh.ok) {
                        const refreshed = (await refresh.json()) as { evidence: PublicEvidence };
                        setEvidence(refreshed.evidence);
                      }
                    }
                    return;
                  }

                  if (body.evidence) {
                    setEvidence(body.evidence);
                  }
                  if (body.verification) {
                    setLatestVerification(body.verification);
                  }

                  const historyResponse = await getEvidenceVerifications(evidence.id);
                  if (historyResponse.ok) {
                    const historyBody = (await historyResponse.json()) as { verifications: PublicVerification[] };
                    setHistory(historyBody.verifications);
                    setLatestVerification(historyBody.verifications[0] ?? body.verification ?? null);
                  }
                } catch {
                  setVerifyError("Unable to verify evidence.");
                } finally {
                  setVerifying(false);
                }
              }}
            />

            <BlockchainPanel
              evidence={evidence}
              blockchain={blockchain}
              userRole={user?.role}
              walletAddress={user?.walletAddress ?? null}
              registering={registering}
              registerError={registerError}
              copied={copied}
              onCopy={(value, key) => {
                void navigator.clipboard.writeText(value);
                setCopied(key);
              }}
              onRegister={async () => {
                setRegisterError(null);
                setRegistering(true);
                try {
                  const response = await registerEvidence(evidence.id);
                  const body = (await response.json()) as {
                    error?: string;
                    evidence?: PublicEvidence;
                    blockchain?: Extract<EvidenceBlockchain, { registered: true }>;
                  };

                  if (response.status === 409) {
                    setRegisterError(body.error ?? "Evidence is already registered.");
                    const refresh = await getEvidenceBlockchain(evidence.id);
                    if (refresh.ok) {
                      setBlockchain((await refresh.json()) as EvidenceBlockchain);
                    }
                    return;
                  }

                  if (!response.ok) {
                    setRegisterError(body.error ?? "Registration failed");
                    return;
                  }

                  if (body.evidence) {
                    setEvidence(body.evidence);
                  }
                  if (body.blockchain) {
                    setBlockchain(body.blockchain);
                  }
                } catch {
                  setRegisterError("Blockchain registration unavailable.");
                } finally {
                  setRegistering(false);
                }
              }}
            />

            {evidence.description ? (
              <p className="mt-6 whitespace-pre-wrap text-sm text-zinc-200">{evidence.description}</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function CopyRow({
  label,
  value,
  copied,
  copyKey,
  onCopy,
}: {
  label: string;
  value: string;
  copied: string | null;
  copyKey: string;
  onCopy: (value: string, key: string) => void;
}) {
  return (
    <div>
      <dt className="text-zinc-400">{label}</dt>
      <dd className="mt-1 flex items-center gap-3">
        <code className="break-all font-mono text-xs text-emerald-300">{value}</code>
        <button
          className="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-xs"
          type="button"
          onClick={() => onCopy(value, copyKey)}
        >
          {copied === copyKey ? "Copied" : "Copy"}
        </button>
      </dd>
    </div>
  );
}

function IntegrityPanel({
  evidence,
  registered,
  latest,
  history,
  verifying,
  verifyError,
  copied,
  onCopy,
  onVerify,
}: {
  evidence: PublicEvidence;
  registered: boolean;
  latest: PublicVerification | null;
  history: PublicVerification[];
  verifying: boolean;
  verifyError: string | null;
  copied: string | null;
  onCopy: (value: string, key: string) => void;
  onVerify: () => Promise<void>;
}) {
  const compromised = evidence.integrityStatus === "COMPROMISED";
  const verified = evidence.integrityStatus === "VERIFIED";

  return (
    <div
      className={`mt-8 rounded-lg border p-5 ${
        compromised ? "border-red-700 bg-red-950/40" : "border-zinc-800"
      }`}
    >
      <h2 className="text-lg font-medium">Integrity Verification</h2>
      <p className="mt-2 text-sm text-zinc-300">
        {verified ? "Evidence Integrity Verified" : null}
        {compromised ? "Evidence Integrity Compromised" : null}
        {!verified && !compromised ? evidence.integrityStatus : null}
      </p>
      {verified ? (
        <p className="mt-2 text-xs text-emerald-300">
          The current file&apos;s SHA-256 matches the original SHA-256 anchored on the blockchain.
        </p>
      ) : null}
      {compromised ? (
        <div className="mt-3 rounded-md border border-red-600 bg-red-950/70 p-4 text-sm text-red-100">
          <p className="font-semibold tracking-wide">EVIDENCE INTEGRITY COMPROMISED</p>
          <p className="mt-2 text-red-200">
            The current file differs from the originally registered bytes. The current file&apos;s
            SHA-256 does not match the original SHA-256 anchored on the blockchain.
          </p>
        </div>
      ) : null}

      {latest ? (
        <dl className="mt-4 grid grid-cols-1 gap-4 text-sm">
          <CopyRow
            label="Original Blockchain Hash"
            value={latest.originalBlockchainHash}
            copied={copied}
            copyKey="original"
            onCopy={onCopy}
          />
          <CopyRow
            label="Current File Hash"
            value={latest.currentHash}
            copied={copied}
            copyKey="current"
            onCopy={onCopy}
          />
          <div>
            <dt className="text-zinc-400">Result</dt>
            <dd className="mt-1">{latest.result}</dd>
          </div>
          <div>
            <dt className="text-zinc-400">Verified At</dt>
            <dd className="mt-1">{new Date(latest.verifiedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-zinc-400">Verified by application user</dt>
            <dd className="mt-1">
              {latest.verifiedBy.fullName} ({latest.verifiedBy.email})
            </dd>
          </div>
          <div>
            <dt className="text-zinc-400">Blockchain Audit</dt>
            <dd className="mt-1">{latest.blockchainAudit.status}</dd>
          </div>
          {latest.blockchainAudit.transactionHash ? (
            <CopyRow
              label="Audit Transaction"
              value={latest.blockchainAudit.transactionHash}
              copied={copied}
              copyKey="auditTx"
              onCopy={onCopy}
            />
          ) : null}
          {latest.blockchainAudit.recordedBy ? (
            <CopyRow
              label="Blockchain transaction sender"
              value={latest.blockchainAudit.recordedBy}
              copied={copied}
              copyKey="auditSigner"
              onCopy={onCopy}
            />
          ) : null}
          {latest.blockchainAudit.message ? (
            <p className="text-xs text-amber-300">{latest.blockchainAudit.message}</p>
          ) : null}
        </dl>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">
          Verification compares the current stored bytes with the original hash on the blockchain.
          The cached SHA-256 is historical metadata and is not used as the expected value.
        </p>
      )}

      <div className="mt-4">
        <button
          className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
          disabled={verifying || !registered}
          type="button"
          onClick={() => {
            void onVerify();
          }}
        >
          {verifying ? "Verifying..." : "Verify Integrity"}
        </button>
        {!registered ? (
          <p className="mt-2 text-xs text-amber-300">
            Evidence must be blockchain registered before integrity verification.
          </p>
        ) : null}
      </div>
      {verifyError ? <p className="mt-3 text-sm text-red-400">{verifyError}</p> : null}

      {history.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-zinc-200">Verification History</h3>
          <ul className="mt-3 space-y-3 text-sm">
            {history.map((item) => (
              <li key={item.id} className="rounded-md border border-zinc-800 p-3">
                <p className="text-zinc-300">{new Date(item.verifiedAt).toLocaleString()}</p>
                <p className="mt-1">{item.result}</p>
                <p className="mt-1 text-zinc-400">Verified by {item.verifiedBy.fullName}</p>
                <p className="mt-1 text-zinc-400">Blockchain audit: {item.blockchainAudit.status}</p>
                {item.blockchainAudit.transactionHash ? (
                  <code className="mt-1 block break-all font-mono text-xs text-emerald-300">
                    {item.blockchainAudit.transactionHash}
                  </code>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function BlockchainPanel({
  evidence,
  blockchain,
  userRole,
  walletAddress,
  registering,
  registerError,
  copied,
  onCopy,
  onRegister,
}: {
  evidence: PublicEvidence;
  blockchain: EvidenceBlockchain | null;
  userRole?: "ORG_ADMIN" | "INVESTIGATOR" | "AUDITOR";
  walletAddress: string | null;
  registering: boolean;
  registerError: string | null;
  copied: string | null;
  onCopy: (value: string, key: string) => void;
  onRegister: () => Promise<void>;
}) {
  const registered = blockchain?.registered === true;
  const canAttempt = userRole === "ORG_ADMIN" || userRole === "INVESTIGATOR";
  const missingWallet = canAttempt && !walletAddress;
  const showRegister =
    canAttempt &&
    !registered &&
    (evidence.blockchainRegistrationStatus === "NOT_REGISTERED" ||
      evidence.blockchainRegistrationStatus === "FAILED");

  return (
    <div className="mt-8 rounded-lg border border-zinc-800 p-5">
      <h2 className="text-lg font-medium">Blockchain Registration</h2>
      <p className="mt-2 text-sm text-zinc-300">
        {registered ? "REGISTERED" : evidence.blockchainRegistrationStatus.replaceAll("_", " ")}
      </p>
      <p className="mt-2 text-xs text-zinc-500">
        Blockchain registered means the original SHA-256 was recorded on the local chain. It does not
        mean the current file has been verified.
      </p>

      {registered ? (
        <dl className="mt-4 grid grid-cols-1 gap-4 text-sm">
          {blockchain.transactionHash ? (
            <CopyRow
              label="Transaction"
              value={blockchain.transactionHash}
              copied={copied}
              copyKey="tx"
              onCopy={onCopy}
            />
          ) : null}
          <CopyRow
            label="Contract"
            value={blockchain.contractAddress}
            copied={copied}
            copyKey="contract"
            onCopy={onCopy}
          />
          <div>
            <dt className="text-zinc-400">Chain ID</dt>
            <dd className="mt-1 font-mono text-xs">{blockchain.chainId}</dd>
          </div>
          <CopyRow
            label="On-chain evidence ID"
            value={blockchain.blockchainEvidenceId}
            copied={copied}
            copyKey="evidenceId"
            onCopy={onCopy}
          />
          {blockchain.originalHash ? (
            <CopyRow
              label="On-chain SHA-256"
              value={blockchain.originalHash}
              copied={copied}
              copyKey="onchain"
              onCopy={onCopy}
            />
          ) : null}
          {blockchain.registeredBy ? (
            <CopyRow
              label="Registered By"
              value={blockchain.registeredBy}
              copied={copied}
              copyKey="registeredBy"
              onCopy={onCopy}
            />
          ) : null}
          {blockchain.currentCustodian ? (
            <CopyRow
              label="On-chain Custodian"
              value={blockchain.currentCustodian}
              copied={copied}
              copyKey="custodian"
              onCopy={onCopy}
            />
          ) : null}
          <div>
            <dt className="text-zinc-400">Registered At</dt>
            <dd className="mt-1">
              {blockchain.registeredOnChainAt
                ? new Date(blockchain.registeredOnChainAt).toLocaleString()
                : "Unknown"}
            </dd>
          </div>
        </dl>
      ) : null}

      {showRegister ? (
        <div className="mt-4">
          {missingWallet ? (
            <p className="text-sm text-amber-300">
              Registration requires an authorized investigator wallet. This account has none
              configured.
            </p>
          ) : (
            <button
              className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
              disabled={registering}
              type="button"
              onClick={() => {
                void onRegister();
              }}
            >
              {registering ? "Registering..." : "Register Evidence"}
            </button>
          )}
        </div>
      ) : null}

      {registerError ? <p className="mt-3 text-sm text-red-400">{registerError}</p> : null}
    </div>
  );
}
