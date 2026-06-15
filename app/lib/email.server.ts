// ─────────────────────────────────────────────────────
// Transactional email via Resend
// ─────────────────────────────────────────────────────

interface EmailPayload {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
}

async function sendEmail(
  apiKey: string,
  payload: EmailPayload
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: payload.from,
      to: [payload.to],
      reply_to: payload.replyTo,
      subject: payload.subject,
      html: payload.html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[email] Resend error:", res.status, text);
    // Don't throw — email failure should not break the booking flow
  }
}

function baseHtml(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { margin: 0; padding: 0; background: #f5f5f7; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; }
  .wrapper { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: rgba(0,0,0,0.1) 0 4px 24px; }
  .header { background: #000; padding: 32px 40px; text-align: center; }
  .header h1 { margin: 0; color: #fff; font-size: 22px; font-weight: 600; letter-spacing: -0.3px; }
  .body { padding: 40px; }
  .body h2 { margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #1d1d1f; }
  .body p { margin: 0 0 12px; font-size: 15px; color: #1d1d1f; line-height: 1.5; }
  .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 15px; }
  .detail-label { color: rgba(0,0,0,0.5); }
  .detail-value { color: #1d1d1f; font-weight: 500; }
  .footer { background: #f5f5f7; padding: 24px 40px; text-align: center; font-size: 12px; color: rgba(0,0,0,0.4); }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header"><h1>Thyme by Vine</h1></div>
  <div class="body">${content}</div>
  <div class="footer">Thyme by Vine · Scheduling made simple</div>
</div>
</body>
</html>`;
}

export interface BookingGroupEmailRow {
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  priceStr: string;
}

export async function sendMultiBookingVerificationEmail(
  apiKey: string,
  opts: {
    to: string;
    bookerName: string;
    bookingRows: BookingGroupEmailRow[];
    totalPrice: number;
    note?: string | null;
    ownerEmail: string;
    ownerName: string;
    confirmUrl: string;
  }
): Promise<void> {
  const rowsHtml = opts.bookingRows
    .map(
      (g) =>
        `<div class="detail-row"><span class="detail-label">${g.resourceName} · ${g.date}</span><span class="detail-value">${g.startTime} – ${g.endTime} · ${g.priceStr}</span></div>`
    )
    .join("");
  const totalStr = opts.totalPrice > 0 ? `$${(opts.totalPrice / 100).toFixed(2)}` : "Free";
  const first = opts.bookingRows[0];
  const subject =
    opts.bookingRows.length === 1
      ? `Please confirm your booking — ${first?.resourceName} on ${first?.date}`
      : `Please confirm your ${opts.bookingRows.length} bookings`;

  const html = baseHtml(`
    <h2>Confirm your booking${opts.bookingRows.length > 1 ? "s" : ""}</h2>
    <p>Hi ${opts.bookerName}, please confirm your booking${opts.bookingRows.length > 1 ? "s" : ""} by clicking the button below. The slots are held for you until you confirm.</p>
    ${rowsHtml}
    <div class="detail-row"><span class="detail-label">Total</span><span class="detail-value">${totalStr}</span></div>
    ${opts.note ? `<div class="detail-row"><span class="detail-label">Note</span><span class="detail-value">${opts.note}</span></div>` : ""}
    <br/>
    <a href="${opts.confirmUrl}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:14px 28px;border-radius:980px;font-size:16px;font-weight:600;">Confirm my booking${opts.bookingRows.length > 1 ? "s" : ""}</a>
    <br/><br/>
    <p style="font-size:13px;color:rgba(0,0,0,0.5)">If you did not make this booking, you can ignore this email. The slots will be released automatically.</p>
  `);

  await sendEmail(apiKey, {
    from: "Thyme by Vine <bookings@thymebyvin.com>",
    to: opts.to,
    replyTo: opts.ownerEmail,
    subject,
    html,
  });
}

export async function sendBookingCancellation(
  apiKey: string,
  opts: {
    to: string;
    bookerName: string;
    resourceNames: string[];
    date: string;
    startTime: string;
    endTime: string;
    ownerEmail: string;
    ownerName: string;
  }
): Promise<void> {
  const resources = opts.resourceNames.join(", ");
  const html = baseHtml(`
    <h2>Booking Cancelled</h2>
    <p>Hi ${opts.bookerName}, your booking has been cancelled. Here were the details:</p>
    <div class="detail-row"><span class="detail-label">Resource</span><span class="detail-value">${resources}</span></div>
    <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${opts.date}</span></div>
    <div class="detail-row"><span class="detail-label">Time</span><span class="detail-value">${opts.startTime} – ${opts.endTime}</span></div>
    <br/>
    <p style="font-size:13px;color:rgba(0,0,0,0.5)">If you have questions, please contact ${opts.ownerName} directly.</p>
  `);

  await sendEmail(apiKey, {
    from: "Thyme by Vine <bookings@thymebyvin.com>",
    to: opts.to,
    replyTo: opts.ownerEmail,
    subject: `Booking Cancelled — ${resources} on ${opts.date}`,
    html,
  });
}
