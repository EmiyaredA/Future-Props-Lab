"""Exact delegated request shape for an already claimed Amadeus action."""

import hashlib
import re

ID = r"[A-Za-z0-9_-]{1,128}"
PURPOSE = "amadeus.operation.approved"
MAX_BODY = 8 * 1024 * 1024
SOURCE = re.compile(rf"/v1/amadeus/conversations/{ID}/actions/{ID}/execute(?:/stream)?")
SHA256 = re.compile(r"[a-f0-9]{64}")


def valid_request_sha256(value):
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def approved_source(grant):
    return (
        grant.caller == "amadeus"
        and grant.purpose == PURPOSE
        and grant.source_method == "POST"
        and SOURCE.fullmatch(grant.source_path) is not None
        and valid_request_sha256(grant.target_sha256)
    )


def request_digest(query, body):
    digest = hashlib.sha256(b"fpl-approved-request-v1\0")
    digest.update(len(query).to_bytes(8, "big"))
    digest.update(query)
    digest.update(body)
    return digest.hexdigest()
