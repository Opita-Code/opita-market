/**
 * WalletWidget — shows the user's wallet balance + withdraw/transfer actions.
 *
 * Hydration: client:visible (only loads when scrolled into view).
 */
import { useEffect, useState } from "react";
import { apiClient, ApiClientError, type BalanceResponse } from "../../lib/api-client";

export interface WalletWidgetProps {
  userId: string;
  initialBalance?: BalanceResponse;
}

export function WalletWidget({ userId, initialBalance }: WalletWidgetProps) {
  const [balance, setBalance] = useState<BalanceResponse | null>(initialBalance ?? null);
  const [error, setError] = useState<string | null>(null);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawPhone, setWithdrawPhone] = useState("");

  useEffect(() => {
    if (initialBalance) return;
    let cancelled = false;
    apiClient.getBalance(userId)
      .then((b) => { if (!cancelled) setBalance(b); })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiClientError ? e.code : "FETCH_FAILED");
      });
    return () => { cancelled = true; };
  }, [userId, initialBalance]);

  if (error) {
    return <div data-testid="wallet-error" className="text-sm text-red-600">No se pudo cargar el balance</div>;
  }

  if (!balance) {
    return (
      <div data-testid="wallet-skeleton" className="animate-pulse">
        <div className="h-8 w-32 bg-slate-200 rounded mb-2" />
        <div className="h-4 w-48 bg-slate-200 rounded" />
      </div>
    );
  }

  return (
    <div data-testid="wallet-widget" className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-baseline gap-2 mb-1">
        <span data-testid="wallet-balance" className="text-2xl font-semibold text-slate-900">
          {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(balance.balance_cop)}
        </span>
        <span className="text-xs text-slate-500">COP</span>
      </div>
      <div className="text-xs text-slate-500 mb-3">
        Límite de retiro diario: {new Intl.NumberFormat("es-CO").format(balance.withdraw_limit_day_cop)} COP
        {balance.withdraw_hold_hours > 0 && ` · Hold ${balance.withdraw_hold_hours}h`}
      </div>

      <button
        type="button"
        onClick={() => setShowWithdraw((s) => !s)}
        className="text-sm font-medium text-sky-700 hover:text-sky-800"
        data-testid="withdraw-toggle"
        aria-expanded={showWithdraw}
      >
        {showWithdraw ? "Cancelar" : "Retirar a Bre-B"}
      </button>

      {showWithdraw && (
        <form
          data-testid="withdraw-form"
          className="mt-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const amount = Number(withdrawAmount);
            if (!Number.isInteger(amount) || amount <= 0) return;
            try {
              await apiClient.withdraw(userId, {
                amount_cop: amount,
                destination: { kind: "BREB", phone: withdrawPhone },
              });
              setShowWithdraw(false);
              setWithdrawAmount("");
              // Refresh balance
              const updated = await apiClient.getBalance(userId);
              setBalance(updated);
            } catch (err) {
              setError(err instanceof ApiClientError ? err.code : "WITHDRAW_FAILED");
            }
          }}
        >
          <input
            type="tel"
            placeholder="+57 300 123 4567"
            value={withdrawPhone}
            onChange={(e) => setWithdrawPhone(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            data-testid="withdraw-phone"
            required
          />
          <input
            type="number"
            placeholder="Monto en COP"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            data-testid="withdraw-amount"
            min={1}
            required
          />
          <button
            type="submit"
            className="w-full bg-sky-600 text-white py-2 rounded text-sm font-medium hover:bg-sky-700"
            data-testid="withdraw-submit"
          >
            Solicitar retiro
          </button>
        </form>
      )}
    </div>
  );
}