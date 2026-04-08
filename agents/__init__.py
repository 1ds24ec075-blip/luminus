"""
Luminus AI Agents Package
Shared utilities for calling different AI providers.
"""
import os
import json
import httpx
from openai import OpenAI

# ── Provider Clients ──

def get_openai_client():
    """Get OpenAI client."""
    return OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
OLLAMA_BASE = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")


async def call_openai(system_prompt: str, user_message: str, model: str = None) -> str:
    """Call OpenAI chat completion."""
    client = get_openai_client()
    model = model or OPENAI_MODEL
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.3,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        return f"[OpenAI Error: {e}]"


async def call_ollama(prompt: str, model: str = "llama3.2") -> str:
    """Call local Ollama instance. Falls back to OpenAI if Ollama is down."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False}
            )
            if response.status_code == 200:
                return response.json().get("response", "")
            raise Exception(f"Ollama returned {response.status_code}")
    except Exception:
        # Fallback to OpenAI
        return await call_openai(
            "You are a medical AI assistant. Be concise and precise.",
            prompt
        )


async def call_gemini(prompt: str) -> str:
    """Call Gemini API. Falls back to OpenAI if no key."""
    if not GEMINI_API_KEY:
        return await call_openai(
            "You are an emergency medical dispatch AI. Be concise.",
            prompt
        )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY}",
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.2}
                }
            )
            if response.status_code == 200:
                data = response.json()
                return data["candidates"][0]["content"]["parts"][0]["text"]
            raise Exception(f"Gemini returned {response.status_code}")
    except Exception:
        return await call_openai(
            "You are an emergency medical dispatch AI. Be concise.",
            prompt
        )
