#   Copyright 2026 UCP Authors
#
#   Licensed under the Apache License, Version 2.0 (the "License");
#   you may not use this file except in compliance with the License.
#   You may obtain a copy of the License at
#
#       http://www.apache.org/licenses/LICENSE-2.0
#
#   Unless required by applicable law or agreed to in writing, software
#   distributed under the License is distributed on an "AS IS" BASIS,
#   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#   See the License for the specific language governing permissions and
#   limitations under the License.

"""Discovery routes for the UCP server."""

import json
import pathlib
import uuid
from fastapi import APIRouter
from fastapi import Request
from ucp_sdk.models.discovery.profile_schema import UcpDiscoveryProfile

router = APIRouter()


def _profile_path() -> pathlib.Path:
  """Resolve discovery profile path (merchant-specific or default)."""
  try:
    import config
    return config._discovery_profile_path()
  except Exception:
    return pathlib.Path(__file__).parent / "discovery_profile.json"


PROFILE_TEMPLATE_PATH = pathlib.Path(__file__).parent / "discovery_profile.json"

# Generate a unique shop ID for this server instance
SHOP_ID = str(uuid.uuid4())


@router.get(
  "/.well-known/ucp",
  response_model=UcpDiscoveryProfile,
  summary="Get Merchant Profile",
)
async def get_merchant_profile(request: Request):
  """Return the merchant profile and capabilities."""
  profile_path = _profile_path()
  with profile_path.open(encoding="utf-8") as f:
    template = f.read()

  # Replace placeholders
  profile_json = template.replace(
    "{{ENDPOINT}}", str(request.base_url).rstrip("/")
  ).replace("{{SHOP_ID}}", SHOP_ID)

  data = json.loads(profile_json)
  # Strip keys not in UcpDiscoveryProfile schema (e.g. merchant extensions)
  for key in list(data):
    if key not in ("ucp", "capabilities", "payment"):
      del data[key]
  # Normalize: SDK expects ucp.capabilities, not top-level capabilities
  if "capabilities" in data and "ucp" in data:
    data["ucp"]["capabilities"] = data.pop("capabilities", [])
  # Ensure payment handlers have required SDK fields
  for handler in data.get("payment", {}).get("handlers", []) or []:
    handler.setdefault(
      "config_schema",
      "https://ucp.dev/schemas/payment-handler-config.json",
    )
    handler.setdefault("instrument_schemas", [])
  return UcpDiscoveryProfile(**data)
