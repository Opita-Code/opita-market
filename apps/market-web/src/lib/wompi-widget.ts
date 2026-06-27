/**
 * Wompi widget script injector (type-safe wrapper).
 *
 * Wompi's widget is a third-party <script> tag that reads data-* attributes
 * and renders its own checkout UI. We inject the tag with the integrity
 * signature from POST /v1/payments/intent.
 *
 * Spec: https://docs.wompi.co/en/docs/colombia/widget-checkout-web/
 */

const WOMPI_WIDGET_URL = "https://checkout.wompi.co/widget.js";

export interface WompiWidgetConfig {
  publicKey: string;
  currency: "COP";
  amountInCents: number;
  reference: string;
  signatureIntegrity: string;
  redirectUrl?: string;
  /** Container element to append the script into. */
  container: HTMLElement;
}

/**
 * Inject the Wompi widget script into the container.
 * Idempotent: calling twice in the same container is a no-op.
 */
export function injectWompiWidget(config: WompiWidgetConfig): HTMLScriptElement | null {
  // Check if already injected (avoid duplicates)
  if (config.container.querySelector('script[src*="checkout.wompi.co"]')) {
    return null;
  }

  const script = document.createElement("script");
  script.src = WOMPI_WIDGET_URL;
  script.setAttribute("data-render", "button");
  script.setAttribute("data-public-key", config.publicKey);
  script.setAttribute("data-currency", config.currency);
  script.setAttribute("data-amount-in-cents", String(config.amountInCents));
  script.setAttribute("data-reference", config.reference);
  script.setAttribute("data-signature:integrity", config.signatureIntegrity);
  if (config.redirectUrl) {
    script.setAttribute("data-redirect-url", config.redirectUrl);
  }

  config.container.appendChild(script);
  return script;
}

/**
 * Remove the Wompi widget script (e.g., when modal closes).
 */
export function removeWompiWidget(container: HTMLElement): void {
  const existing = container.querySelector('script[src*="checkout.wompi.co"]');
  if (existing) existing.remove();
}