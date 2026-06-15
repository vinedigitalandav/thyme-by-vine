// ─────────────────────────────────────────────────────
// Stripe REST API helpers for Cloudflare Workers
// Uses fetch directly — no Node.js SDK required
// ─────────────────────────────────────────────────────

const STRIPE_API = "https://api.stripe.com/v1";

export async function createPaymentIntent(
  secretKey: string,
  opts: {
    amountCents: number;
    currency?: string;
    description?: string;
    receiptEmail?: string;
    metadata?: Record<string, string>;
  }
): Promise<{ id: string; clientSecret: string }> {
  const body = new URLSearchParams({
    amount: String(opts.amountCents),
    currency: opts.currency ?? "usd",
  });
  body.append("payment_method_types[]", "card");
  if (opts.description) body.append("description", opts.description);
  if (opts.receiptEmail) body.append("receipt_email", opts.receiptEmail);
  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      body.append(`metadata[${k}]`, v);
    }
  }

  const res = await fetch(`${STRIPE_API}/payment_intents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? "Stripe error creating payment intent");
  }

  const pi = (await res.json()) as { id: string; client_secret: string };
  return { id: pi.id, clientSecret: pi.client_secret };
}

export async function getPaymentIntentStatus(
  secretKey: string,
  intentId: string
): Promise<string> {
  const res = await fetch(
    `${STRIPE_API}/payment_intents/${encodeURIComponent(intentId)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );
  if (!res.ok) throw new Error("Failed to verify payment intent");
  const pi = (await res.json()) as { status: string };
  return pi.status;
}
