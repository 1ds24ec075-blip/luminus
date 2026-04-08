"""
Luminus — Authentication Helpers
JWT tokens + bcrypt password hashing.
"""
import os
import hashlib
import hmac
import time
import json
import base64
from datetime import datetime, timedelta

# Use a simple HMAC-SHA256 JWT implementation to avoid heavy deps
SECRET_KEY = os.getenv("JWT_SECRET", "luminus-hackathon-secret-key-2026")
TOKEN_EXPIRY_HOURS = 24


def hash_password(password: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 (stdlib, no bcrypt needed)."""
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
    return (salt + key).hex()


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify password against stored PBKDF2 hash."""
    data = bytes.fromhex(stored_hash)
    salt = data[:16]
    stored_key = data[16:]
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
    return hmac.compare_digest(key, stored_key)


def create_token(user_id: int, role: str, name: str) -> str:
    """Create a simple JWT-like token."""
    payload = {
        "user_id": user_id,
        "role": role,
        "name": name,
        "exp": int((datetime.now() + timedelta(hours=TOKEN_EXPIRY_HOURS)).timestamp())
    }
    payload_json = json.dumps(payload)
    payload_b64 = base64.urlsafe_b64encode(payload_json.encode()).decode()
    signature = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{signature}"


def verify_token(token: str) -> dict | None:
    """Verify and decode a token. Returns payload dict or None."""
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, signature = parts
        expected_sig = hmac.new(SECRET_KEY.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return None
        payload_json = base64.urlsafe_b64decode(payload_b64.encode()).decode()
        payload = json.loads(payload_json)
        if payload.get("exp", 0) < int(datetime.now().timestamp()):
            return None
        return payload
    except Exception:
        return None
