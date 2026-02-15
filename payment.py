"""UPI deep link and QR code generation for agentic commerce."""

import base64
import io
import urllib.parse

import qrcode


def generate_upi_link(
  vpa: str,
  name: str,
  amount_paise: int,
  order_id: str,
  note: str | None = None,
) -> str:
  """Generate UPI deep link for payment.

  Args:
    vpa: Merchant VPA (e.g. artisanindia@ybl).
    name: Payee name (URL-encoded safe).
    amount_paise: Amount in paise (minor units).
    order_id: Order or transaction reference.
    note: Optional note (tn is used for transaction note).

  Returns:
    UPI URI string, e.g. upi://pay?pa=...&pn=...&am=...&cu=INR&tn=...
  """
  amount_inr = amount_paise / 100
  # UPI amount is typically 2 decimal places
  am = f"{amount_inr:.2f}"
  pn = urllib.parse.quote(name)
  tn = urllib.parse.quote(note or f"Order_{order_id}")
  return (
    f"upi://pay?pa={vpa}&pn={pn}&am={am}&cu=INR&tn={tn}"
  )


def generate_qr_base64(upi_link: str, size: int = 4) -> str:
  """Generate QR code image as base64-encoded PNG.

  Args:
    upi_link: UPI payment URI.
    size: QR box size in pixels (default 4).

  Returns:
    Base64-encoded PNG string (no data URL prefix).
  """
  qr = qrcode.QRCode(version=1, box_size=size, border=2)
  qr.add_data(upi_link)
  qr.make(fit=True)
  img = qr.make_image(fill_color="black", back_color="white")
  buf = io.BytesIO()
  img.save(buf, format="PNG")
  buf.seek(0)
  return base64.b64encode(buf.read()).decode("ascii")
