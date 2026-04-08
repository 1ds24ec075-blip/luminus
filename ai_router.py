import os
import re
import json
import logging
import urllib.request
import urllib.error

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def strip_pii(text: str) -> str:
    redacted = re.sub(r'(?<!^)(?<!\.\s)\b[A-Z][a-z]+\b', '[REDACTED]', text)
    redacted = re.sub(r'\b(?:age\s*\d{1,3}|\d{1,2}/\d{1,2}/\d{2,4})\b', '[AGE/DATE]', redacted, flags=re.IGNORECASE)
    return redacted

def _http_post_json(url: str, payload: dict, headers: dict = None, timeout: float = 25.0) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    request_obj = urllib.request.Request(url, data=body, headers=req_headers, method="POST")
    try:
        with urllib.request.urlopen(request_obj, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="ignore") if exc.fp else ""
        return {"error": f"HTTP {exc.code}", "details": details[:240]}
    except Exception as exc:
        return {"error": str(exc)[:240]}

class SensitivityAwareRouter:
    def __init__(self):
        self.ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self.ollama_model = "qwen:7b"
        self.groq_key = os.getenv("GROQ_API_KEY")
        self.groq_model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        self.openai_key = os.getenv("OPENAI_API_KEY")
        self.openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    def route_request(self, task_type: str, data_sensitivity: str, complexity: str, payload: dict) -> dict:
        """
        task_type: 'REALTIME' (Chat/Fast) | 'BATCH' | 'REASONING'
        data_sensitivity: 'HIGH' (Ollama) | 'MEDIUM' | 'LOW'
        complexity: 'HIGH' (OpenAI) | 'LOW'
        """
        logger.info(f"[ROUTER] Routing Request - Task: {task_type}, Sensitivity: {data_sensitivity}, Complexity: {complexity}")

        if data_sensitivity == "HIGH":
            return self._call_ollama(payload)
        
        if task_type == "REALTIME":
            try:
                return self._call_groq(payload)
            except Exception as e:
                logger.warning(f"[ROUTER] Groq failed, falling back to Ollama: {e}")
                return self._call_ollama(payload)

        if complexity == "HIGH":
            try:
                # Security feature: Strip PII before hitting remote models
                if "prompt" in payload:
                    payload["prompt"] = strip_pii(payload["prompt"])
                if "messages" in payload:
                    for m in payload["messages"]:
                        if "content" in m and isinstance(m["content"], str):
                            m["content"] = strip_pii(m["content"])

                return self._call_openai(payload)
            except Exception as e:
                logger.warning(f"[ROUTER] OpenAI failed, falling back to Groq: {e}")
                try:
                    return self._call_groq(payload)
                except Exception as e2:
                    logger.warning(f"[ROUTER] Groq fallback failed, falling back to Ollama: {e2}")
                    return self._call_ollama(payload)

        return self._call_ollama(payload)

    def _call_ollama(self, payload: dict) -> dict:
        logger.info("[ROUTER] Executing on OLLAMA (Secure / Trust)")
        url = f"{self.ollama_url}/api/generate"
        prompt = payload.get("prompt", "")
        if not prompt and "messages" in payload:
            prompt = "\n".join([f"{m['role']}: {m['content']}" for m in payload["messages"]])

        body = {
            "model": self.ollama_model,
            "prompt": prompt,
            "system": payload.get("system", "You are a precise medical AI assistant."),
            "stream": False,
            "format": "json" if payload.get("json_mode") else ""
        }
        res = _http_post_json(url, body, timeout=120.0)
        if "error" in res:
            raise Exception(res.get("details", res["error"]))
        
        return {
            "source": "Ollama (Local)", 
            "status": "success", 
            "content": res.get("response", "")
        }

    def _call_groq(self, payload: dict) -> dict:
        logger.info("[ROUTER] Executing on GROQ (Fast / Real-time)")
        if not self.groq_key:
            raise ValueError("Groq API key not configured")
            
        url = "https://api.groq.com/openai/v1/chat/completions"
        messages = payload.get("messages", [{"role": "user", "content": payload.get("prompt", "")}])
        
        if "system" in payload and messages[0]["role"] != "system":
            messages.insert(0, {"role": "system", "content": payload.get("system")})

        body = {
            "model": self.groq_model,
            "messages": messages,
            "temperature": 0.2
        }
        
        if payload.get("json_mode"):
            body["response_format"] = {"type": "json_object"}

        res = _http_post_json(url, body, headers={"Authorization": f"Bearer {self.groq_key}"})
        if "error" in res:
            raise Exception(res.get("details", res["error"]))

        content = res.get("choices", [{}])[0].get("message", {}).get("content", "")
        return {"source": "Groq", "status": "success", "content": content}

    def _call_openai(self, payload: dict) -> dict:
        logger.info("[ROUTER] Executing on OPENAI/GEMINI (Smart / Complex Thinking)")
        if not self.openai_key:
            raise ValueError("OpenAI API key not configured")
            
        url = "https://api.openai.com/v1/chat/completions"
        messages = payload.get("messages", [{"role": "user", "content": payload.get("prompt", "")}])
        
        if "system" in payload and messages[0]["role"] != "system":
            messages.insert(0, {"role": "system", "content": payload.get("system")})

        body = {
            "model": self.openai_model,
            "messages": messages,
            "temperature": 0.2
        }
        
        if payload.get("json_mode"):
            body["response_format"] = {"type": "json_object"}

        res = _http_post_json(url, body, headers={"Authorization": f"Bearer {self.openai_key}"})
        if "error" in res:
            raise Exception(res.get("details", res["error"]))

        content = res.get("choices", [{}])[0].get("message", {}).get("content", "")
        return {"source": "OpenAI / Gemini", "status": "success", "content": content}
