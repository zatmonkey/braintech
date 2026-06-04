#!/usr/bin/env python3
"""
Grant the Braintech GA service account Viewer access on the GA4 property,
bypassing the broken Add-Users dialog.

Uses your USER credentials (Application Default Credentials), not the
service account's, since the SA can't grant itself access.

Prereq:
    gcloud auth application-default login
    gcloud config set project braintech-498416
    # And enable the Admin API the first time:
    gcloud services enable analyticsadmin.googleapis.com --project=braintech-498416

Then:
    BRAINTECH_PY=$HOME/.config/braintech/venv/bin/python
    $BRAINTECH_PY scripts/grant_ga_access.py

The script tries Property-level first; if that fails it tries Account-level
(which cascades to all properties under the account).
"""

from __future__ import annotations
import sys
# AccessBinding only exists in v1alpha (v1beta intentionally omits access
# binding management — only the access report API is there).
from google.analytics.admin_v1alpha import AnalyticsAdminServiceClient
from google.analytics.admin_v1alpha.types import AccessBinding

PROPERTY_ID = "538346217"
SA_EMAIL = "ga-agent@braintech-498416.iam.gserviceaccount.com"
VIEWER_ROLE = "predefinedRoles/viewer"


def grant_property() -> str:
    client = AnalyticsAdminServiceClient()
    parent = f"properties/{PROPERTY_ID}"
    binding = AccessBinding(user=SA_EMAIL, roles=[VIEWER_ROLE])
    resp = client.create_access_binding(parent=parent, access_binding=binding)
    return resp.name


def grant_account(account_id: str) -> str:
    client = AnalyticsAdminServiceClient()
    parent = f"accounts/{account_id}"
    binding = AccessBinding(user=SA_EMAIL, roles=[VIEWER_ROLE])
    resp = client.create_access_binding(parent=parent, access_binding=binding)
    return resp.name


def find_account_id_for_property() -> str | None:
    """The Admin API returns 'accounts/<id>' on each property entry."""
    client = AnalyticsAdminServiceClient()
    for p in client.list_account_summaries():
        for sub in p.property_summaries:
            # property names look like "properties/538346217"
            if sub.property.endswith(f"/{PROPERTY_ID}"):
                # account names look like "accounts/123456789"
                return p.account.split("/")[-1]
    return None


def main() -> int:
    print(f"Granting {SA_EMAIL} Viewer on property {PROPERTY_ID} …")
    try:
        name = grant_property()
        print(f"OK — created access binding at: {name}")
        return 0
    except Exception as e:
        print(f"Property-level failed: {type(e).__name__}: {str(e)[:300]}")

    print("Falling back to Account-level access (cascades to property) …")
    try:
        acct = find_account_id_for_property()
        if not acct:
            print(
                "Couldn't find an account containing this property. Your user "
                "may not have visibility to it."
            )
            return 2
        print(f"Found account {acct}, granting there …")
        name = grant_account(acct)
        print(f"OK — created access binding at: {name}")
        return 0
    except Exception as e:
        print(f"Account-level failed too: {type(e).__name__}: {str(e)[:600]}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
