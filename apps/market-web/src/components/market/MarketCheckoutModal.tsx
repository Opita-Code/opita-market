/**
 * MarketCheckoutModal — full payment flow with Wompi widget.
 *
 * Hydration: client:only="react" (Wompi widget needs full DOM).
 *
 * Flow:
 *   1. User clicks "Pagar" → modal opens
 *   2. POST /v1/payments/intent → get integrity signature
 *   3. Inject Wompi widget with signature
 *   4. User completes payment in widget
 *   5. Wompi redirects back to redirect_url with ?id=<transaction_id>
 *   6. Page shows success state
 */
import { useEffect, useRef, useState } from "react";
import { apiClient, ApiClientError, type IntentRequest, type IntentResponse } from "../../lib/api-client";
import { injectWompiWidget, removeWompiWidget } from "../../lib/wompi-widget";
import { computeDeviceFingerprint } from "../../lib/device-fingerprint";

export interface MarketCheckoutModalProps {
  open: boolean;
  onClose: () => void;
  amountCop: number;
  channel: IntentRequest["channel"];
  fromUserId: string;
  toUserId: string;
  productContext: { kind: string; ref_id: string };
  /** Page to redirect to after payment (Wompi appends ?id=<tx_id>) */
  redirectUrl?: string;
}

type ModalState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; intent: IntentResponse }
  | { kind: "error"; code: string };

function generateIdempotencyKey(): string {
  // Crypto-quality randomness for idempotency (collisions astronomically unlikely)
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function MarketCheckoutModal(props: MarketCheckoutModalProps) {
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ModalState>({ kind: "idle" });
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  // Fetch intent when modal opens
  useEffect(() => {
    if (!props.open) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "loading" });
    // PR 7 — Collect device fingerprint (closes OPL-CARD-013).
    // FingerprintJS open-source is async; we collect in parallel with the intent
    // call but don't block on it. If the fingerprint fails, we send the intent
    // without device_id (backend will treat as missing — not a hard fail).
    Promise.all([computeDeviceFingerprint()])
      .then(([deviceId]) => {
        apiClient
          .createPaymentIntent({
            amount_cop: props.amountCop,
            channel: props.channel,
            from_user_id: props.fromUserId,
            to_user_id: props.toUserId,
            product_context: props.productContext,
            idempotency_key: idempotencyKeyRef.current,
            device_id: deviceId ?? undefined,
          })
          .then((intent) => setState({ kind: "ready", intent }))
          .catch((e) => {
            const code = e instanceof ApiClientError ? e.code : "INTENT_FAILED";
            setState({ kind: "error", code });
          });
      })
      .catch(() => {
        // Fingerprint failed — still send the intent, just without device_id
        apiClient
          .createPaymentIntent({
            amount_cop: props.amountCop,
            channel: props.channel,
            from_user_id: props.fromUserId,
            to_user_id: props.toUserId,
            product_context: props.productContext,
            idempotency_key: idempotencyKeyRef.current,
          })
          .then((intent) => setState({ kind: "ready", intent }))
          .catch((e) => {
            const code = e instanceof ApiClientError ? e.code : "INTENT_FAILED";
            setState({ kind: "error", code });
          });
      });
  }, [props.open, props.amountCop, props.channel, props.fromUserId, props.toUserId, props.productContext.kind, props.productContext.ref_id]);

  // Inject Wompi widget when ready
  useEffect(() => {
    if (state.kind !== "ready" || !widgetContainerRef.current) return;
    const intent = state.intent;
    const script = injectWompiWidget({
      publicKey: intent.public_key,
      currency: intent.currency,
      amountInCents: intent.amount_in_cents,
      reference: intent.reference,
      signatureIntegrity: intent.integrity_signature,
      redirectUrl: props.redirectUrl,
      container: widgetContainerRef.current,
    });
    return () => {
      if (widgetContainerRef.current) {
        removeWompiWidget(widgetContainerRef.current);
      }
    };
  }, [state, props.redirectUrl]);

  if (!props.open) return null;

  return (
    <div
      data-testid="checkout-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={props.onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={props.onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
          aria-label="Cerrar"
          data-testid="modal-close"
        >
          ✕
        </button>

        <div className="p-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Confirmar pago</h2>
          <p className="text-sm text-slate-600 mb-6">
            {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(props.amountCop)}
            {" · "}
            {props.channel.replace("WOMPI_", "")}
          </p>

          {state.kind === "loading" && (
            <div data-testid="loading" className="py-8 text-center text-slate-500">
              <div className="inline-block w-6 h-6 border-2 border-slate-300 border-t-sky-600 rounded-full animate-spin mb-2" />
              <p className="text-sm">Preparando pago seguro…</p>
            </div>
          )}

          {state.kind === "error" && (
            <div data-testid="error" className="py-8 text-center">
              <p className="text-sm text-red-600">Error: {state.code}</p>
              <button
                type="button"
                onClick={props.onClose}
                className="mt-4 text-sm text-sky-700 hover:text-sky-800"
              >
                Cerrar
              </button>
            </div>
          )}

          {state.kind === "ready" && (
            <div data-testid="widget-container" ref={widgetContainerRef} className="py-4 min-h-[60px]" />
          )}

          <p className="text-xs text-slate-400 mt-6 text-center">
            Pagos procesados de forma segura por Wompi Bancolombia.
          </p>
        </div>
      </div>
    </div>
  );
}