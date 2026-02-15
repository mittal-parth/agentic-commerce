"use client";

import { cn } from "@/lib/utils";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

export type CheckoutViewData = {
  _ui?: { type: string };
  checkout_session_id?: string;
  order_total_paise: number;
  upi_link?: string;
  qr_base64?: string;
  message?: string;
};

type CheckoutViewProps = {
  data: CheckoutViewData;
  className?: string;
};

export function CheckoutView({ data, className }: CheckoutViewProps) {
  const totalPaise = data.order_total_paise ?? 0;
  const qrBase64 = data.qr_base64?.trim();
  const qrDataUrl = qrBase64
    ? `data:image/png;base64,${qrBase64}`
    : null;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden",
        className
      )}
    >
      <div className="border-b bg-muted/30 px-4 py-3">
        <p className="text-muted-foreground text-xs uppercase tracking-wide">
          Pay with UPI
        </p>
        <p className="mt-1 font-semibold text-xl text-foreground">
          {INR.format(totalPaise / 100)}
        </p>
      </div>
      <div className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:items-start sm:justify-center">
        {qrDataUrl && (
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div className="rounded-lg border bg-white p-3 shadow-sm">
              <img
                src={qrDataUrl}
                alt="UPI payment QR code"
                className="h-48 w-48 object-contain"
              />
            </div>
            <p className="text-center text-muted-foreground text-xs">
              Scan with your UPI app
            </p>
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          {data.message && (
            <p className="text-muted-foreground">{data.message}</p>
          )}
          {data.upi_link && (
            <p className="break-all rounded bg-muted/50 px-2 py-1.5 font-mono text-xs text-foreground">
              {data.upi_link}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
