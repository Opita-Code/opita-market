/**
 * ReferralCodeCard — shows the user's referral code with copy-to-clipboard.
 *
 * Hydration: client:idle (non-critical for initial page load).
 */
import { useEffect, useState } from "react";
import { apiClient, type ReferralCodeResponse } from "../../lib/api-client";

export interface ReferralCodeCardProps {
  userId: string;
  initialCode?: string;
}

export function ReferralCodeCard({ userId, initialCode }: ReferralCodeCardProps) {
  const [code, setCode] = useState<string | null>(initialCode ?? null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialCode) return;
    let cancelled = false;
    apiClient.getReferralCode(userId)
      .then((r) => { if (!cancelled) setCode(r.referral_code); })
      .catch(() => { if (!cancelled) setError("FETCH_FAILED"); });
    return () => { cancelled = true; };
  }, [userId, initialCode]);

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("COPY_FAILED");
    }
  };

  return (
    <div data-testid="referral-card" className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-medium text-slate-900 mb-2">Tu código de referido</h3>
      {error && <p data-testid="referral-error" className="text-sm text-red-600">No se pudo cargar</p>}
      {code && (
        <>
          <div className="flex items-center gap-2">
            <code
              data-testid="referral-code"
              className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded font-mono text-lg tracking-wider"
            >
              {code}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2 bg-sky-600 text-white rounded text-sm font-medium hover:bg-sky-700"
              data-testid="referral-copy"
              data-copied={copied}
            >
              {copied ? "¡Copiado!" : "Copiar"}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Comparte este código. Ambos ganan unidades cuando se complete la primera compra.
          </p>
        </>
      )}
    </div>
  );
}