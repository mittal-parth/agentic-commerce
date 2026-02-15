#!/usr/bin/env python3
"""
MCP shopping client: discover any UCP merchant and browse, cart, checkout via tools.

Set MERCHANT_URL to connect to a merchant, or use discover_merchant(url) first.
"""

import os
import uuid
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

from payment import generate_qr_base64
from payment import generate_upi_link

mcp = FastMCP(
    "Artisan Commerce",
    instructions="Shopping assistant for UCP merchants. Discover a merchant first, then browse and shop.",
)

# Module-level state: connected merchant and cart
_merchant_base_url: str | None = os.environ.get("MERCHANT_URL", "").rstrip("/") or None
_merchant_profile: dict[str, Any] | None = None
_cart: list[dict[str, Any]] = []  # [{ "product_id", "title", "price", "quantity" }]
_checkout_session_id: str | None = None


def _auto_discover():
    """Auto-discover merchant if MERCHANT_URL is set."""
    global _merchant_profile
    if _merchant_base_url and not _merchant_profile:
        try:
            with httpx.Client(timeout=10.0) as client:
                r = client.get(f"{_merchant_base_url}/.well-known/ucp")
                r.raise_for_status()
                _merchant_profile = r.json()
        except Exception:
            pass  # Will be fetched on first explicit call


def _require_merchant() -> str:
    if not _merchant_base_url:
        return (
            "No merchant connected. Use **discover_merchant(url)** first, "
            "or set the MERCHANT_URL environment variable."
        )
    # Auto-discover profile if not already fetched
    _auto_discover()
    return ""


def _ucp_headers() -> dict[str, str]:
    return {
        "UCP-Agent": 'profile="https://agent.example/mcp-commerce"',
        "Request-Signature": "mcp-demo",
        "Idempotency-Key": str(uuid.uuid4()),
        "Request-Id": str(uuid.uuid4()),
        "Content-Type": "application/json",
    }


# ---- Tools ----


@mcp.tool()
def discover_merchant(merchant_url: str) -> str:
    """Connect to a UCP merchant by URL. Fetches /.well-known/ucp and stores the merchant for browsing and checkout.

    Call this first with the merchant's base URL (e.g. http://localhost:8000).
    """
    global _merchant_base_url, _merchant_profile
    url = merchant_url.rstrip("/")
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(f"{url}/.well-known/ucp")
            r.raise_for_status()
            _merchant_profile = r.json()
            _merchant_base_url = url
    except httpx.HTTPError as e:
        return f"Failed to discover merchant at {url}: {e}"
    cap = _merchant_profile.get("ucp", {}).get("capabilities", [])
    handlers = _merchant_profile.get("payment", {}).get("handlers", [])
    name = _merchant_profile.get("merchant", {}).get("name", "Merchant")
    categories = _merchant_profile.get("merchant", {}).get("product_categories", "")
    out = [
        f"# Connected to **{name}**",
        f"**Base URL:** `{_merchant_base_url}`",
        f"**Capabilities:** {', '.join(c.get('name', '') for c in cap)}",
        f"**Payment handlers:** {', '.join(h.get('id', '') for h in handlers)}",
    ]
    if categories:
        out.append(f"**Product categories:** {categories}")
    out.append("\nYou can now use **browse_categories**, **search_products**, **get_product**, **add_to_cart**, etc.")
    return "\n".join(out)


@mcp.tool()
def browse_categories() -> str:
    """List product categories and counts from the connected merchant (from /catalogue)."""
    err = _require_merchant()
    if err:
        return err
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(f"{_merchant_base_url}/catalogue")
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPError as e:
        return f"Failed to load catalogue: {e}"
    products = data.get("products", [])
    by_cat: dict[str, int] = {}
    for p in products:
        cat = p.get("category") or "general"
        by_cat[cat] = by_cat.get(cat, 0) + 1
    lines = ["# Categories", ""]
    for c in sorted(by_cat.keys()):
        lines.append(f"- **{c}**: {by_cat[c]} products")
    return "\n".join(lines) if lines else "No categories found."


@mcp.tool()
def search_products(query: str = "", category: str | None = None) -> str:
    """Search products by keyword and optional category. Returns rich markdown product cards."""
    err = _require_merchant()
    if err:
        return err
    params: dict[str, str] = {}
    if query:
        params["q"] = query
    if category:
        params["category"] = category
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(f"{_merchant_base_url}/products", params=params)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPError as e:
        return f"Search failed: {e}"
    items = data.get("products", [])
    if not items:
        return "No products found."
    lines = ["# Products", ""]
    for p in items:
        price_rs = p["price"] / 100
        img = p.get("image_url", "")
        card = [
            f"## {p['title']}",
            f"- **ID:** `{p['id']}`",
            f"- **Price:** Rs. {price_rs:,.2f}",
        ]
        if p.get("category"):
            card.append(f"- **Category:** {p['category']}")
        if p.get("origin_state"):
            card.append(f"- **Origin:** {p['origin_state']}")
        if p.get("artisan_name"):
            card.append(f"- **Artisan:** {p['artisan_name']}")
        if img:
            card.append(f"![{p['title']}]({img})")
        if p.get("description"):
            card.append(f"\n{p['description'][:200]}...")
        card.append("")
        lines.append("\n".join(card))
    return "\n".join(lines)


@mcp.tool()
def get_product(product_id: str) -> str:
    """Get full product details by ID."""
    err = _require_merchant()
    if err:
        return err
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(f"{_merchant_base_url}/products/{product_id}")
            r.raise_for_status()
            p = r.json()
    except httpx.HTTPError as e:
        return f"Product not found or error: {e}"
    price_rs = p["price"] / 100
    lines = [
        f"# {p['title']}",
        f"- **ID:** `{p['id']}`",
        f"- **Price:** Rs. {price_rs:,.2f}",
    ]
    if p.get("category"):
        lines.append(f"- **Category:** {p['category']}")
    if p.get("origin_state"):
        lines.append(f"- **Origin:** {p['origin_state']}")
    if p.get("artisan_name"):
        lines.append(f"- **Artisan:** {p['artisan_name']}")
    if p.get("image_url"):
        lines.append(f"\n![{p['title']}]({p['image_url']})")
    if p.get("description"):
        lines.append(f"\n{p['description']}")
    return "\n".join(lines)


@mcp.tool()
def add_to_cart(product_id: str, quantity: int = 1) -> str:
    """Add a product to the cart. Use the product ID from search or get_product."""
    err = _require_merchant()
    if err:
        return err
    if quantity < 1:
        return "Quantity must be at least 1."
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(f"{_merchant_base_url}/products/{product_id}")
            r.raise_for_status()
            p = r.json()
    except httpx.HTTPError as e:
        return f"Product not found: {e}"
    for item in _cart:
        if item["product_id"] == product_id:
            item["quantity"] += quantity
            return view_cart()
    _cart.append({
        "product_id": p["id"],
        "title": p["title"],
        "price": p["price"],
        "quantity": quantity,
    })
    return view_cart()


@mcp.tool()
def view_cart() -> str:
    """Show current cart with line items and totals."""
    if not _cart:
        return "Your cart is empty."
    lines = ["# Cart", "", "| Product | Qty | Price (Rs.) |", "| --- | --- | --- |"]
    total_paise = 0
    for item in _cart:
        price_rs = item["price"] * item["quantity"] / 100
        total_paise += item["price"] * item["quantity"]
        lines.append(f"| {item['title']} | {item['quantity']} | {price_rs:,.2f} |")
    lines.append(f"| **Total** | | **Rs. {total_paise / 100:,.2f}** |")
    return "\n".join(lines)


@mcp.tool()
def update_cart(product_id: str, quantity: int) -> str:
    """Update quantity for a product in the cart. Use 0 to remove."""
    for i, item in enumerate(_cart):
        if item["product_id"] == product_id:
            if quantity <= 0:
                _cart.pop(i)
            else:
                item["quantity"] = quantity
            return view_cart()
    return f"Product `{product_id}` not in cart."


@mcp.tool()
def remove_from_cart(product_id: str) -> str:
    """Remove a product from the cart."""
    return update_cart(product_id, 0)


def _build_create_payload() -> dict[str, Any]:
    handlers = (_merchant_profile or {}).get("payment", {}).get("handlers", [])
    if not handlers:
        handlers = [{"id": "upi", "name": "in.npci.upi", "version": "2026-01-11", "config": {}}]
    line_items = [
        {
            "item": {"id": item["product_id"], "title": item["title"], "price": item["price"]},
            "quantity": item["quantity"],
        }
        for item in _cart
    ]
    # Fulfillment: default Indian address and standard shipping so complete can succeed
    fulfillment = {
        "methods": [
            {
                "type": "shipping",
                "destinations": [
                    {
                        "id": "dest_1",
                        "street_address": "123 Demo St",
                        "address_locality": "Mumbai",
                        "address_region": "MH",
                        "postal_code": "400001",
                        "address_country": "IN",
                    }
                ],
                "selected_destination_id": "dest_1",
                "groups": [
                    {
                        "id": "group_1",
                        "line_item_ids": [],
                        "options": [
                            {"id": "std-in", "title": "Standard Shipping (India)", "totals": [{"type": "total", "amount": 5000}]}
                        ],
                        "selected_option_id": "std-in",
                    }
                ],
            }
        ]
    }
    return {
        "currency": "INR",
        "line_items": line_items,
        "payment": {
            "handlers": handlers,
            "instruments": [],
            "selected_instrument_id": None,
        },
        "fulfillment": fulfillment,
    }


@mcp.tool()
def checkout() -> str:
    """Create a checkout session and return UPI payment link and QR code. Scan the QR or open the link to pay."""
    err = _require_merchant()
    if err:
        return err
    if not _cart:
        return "Cart is empty. Add items first."
    global _checkout_session_id
    payload = _build_create_payload()
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                f"{_merchant_base_url}/checkout-sessions",
                json=payload,
                headers=_ucp_headers(),
            )
            r.raise_for_status()
            checkout_data = r.json()
    except httpx.HTTPError as e:
        return f"Checkout failed: {e}"
    _checkout_session_id = checkout_data.get("id")
    totals = checkout_data.get("totals", [])
    total_paise = 0
    for t in totals:
        if t.get("type") == "total":
            total_paise = t.get("amount", 0)
            break
    handlers = (_merchant_profile or {}).get("payment", {}).get("handlers", [])
    vpa = "merchant@ybl"
    name = "Merchant"
    for h in handlers:
        if h.get("id") == "upi" and isinstance(h.get("config"), dict):
            vpa = h["config"].get("vpa", vpa)
            name = h["config"].get("merchant_name", name)
    order_id = _checkout_session_id or "order"
    upi_link = generate_upi_link(vpa, name, total_paise, order_id)
    qr_b64 = generate_qr_base64(upi_link)
    lines = [
        "# Checkout – Pay via UPI",
        f"**Order total:** Rs. {total_paise / 100:,.2f}",
        "",
        "**UPI link:**",
        f"[Pay with UPI]({upi_link})",
        "",
        "**QR code (scan with UPI app):**",
        f"![UPI QR](data:image/png;base64,{qr_b64})",
        "",
        "After paying, use **confirm_payment(utr)** with your UTR/reference number.",
    ]
    return "\n".join(lines)


@mcp.tool()
def confirm_payment(utr: str = "") -> str:
    """Confirm that payment is done and complete the order. Optionally pass UTR/reference from your UPI app."""
    global _checkout_session_id, _cart
    err = _require_merchant()
    if err:
        return err
    if not _checkout_session_id:
        return "No checkout in progress. Use **checkout()** first."
    # Build card instrument (UCP SDK currently requires card type)
    # Using simulated card data for demo purposes
    instrument = {
        "id": "card_1",
        "handler_id": "upi",
        "handler_name": "in.npci.upi",
        "type": "card",
        "brand": "visa",
        "last_digits": "4242",
        "credential": {"type": "token", "token": utr or "upi_success"},
    }
    payload = {
        "payment_data": instrument,
        "risk_signals": {},
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.post(
                f"{_merchant_base_url}/checkout-sessions/{_checkout_session_id}/complete",
                json=payload,
                headers=_ucp_headers(),
            )
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPError as e:
        return f"Complete failed: {e}"
    order = data.get("order", {})
    order_id = order.get("id") if isinstance(order, dict) else (data.get("order") or {}).get("id")
    if not order_id and isinstance(data.get("order"), dict):
        order_id = data["order"].get("id")
    # Reset for next order
    _checkout_session_id_used = _checkout_session_id
    _cart = []
    _checkout_session_id = None
    lines = [
        "# Order confirmed",
        f"**Order ID:** {order_id or _checkout_session_id_used}",
        "Thank you for your payment.",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run(transport="stdio")
