# Luminus

Luminus is a patient dashboard with a Lumi Assistant chatbot powered by OpenAI.

## Tech Stack

- Frontend: HTML/CSS/JavaScript (served from `frontend-ui`)
- Backend: FastAPI (`server.py`)
- AI: OpenAI Chat Completions API

## Project Structure

- `frontend-ui/` -> UI files (`index.html`, `styles.css`, `app.js`)
- `server.py` -> FastAPI backend + static file serving + chat API
- `.env.example` -> environment variable template
- `requirements.txt` -> Python dependencies

## Prerequisites

- Python 3.10+
- OpenAI API key

## 1. Create Virtual Environment (first time)

Windows PowerShell:

```powershell
python -m venv .venv
```

## 2. Install Dependencies

Windows PowerShell:

```powershell
.venv/Scripts/python.exe -m pip install -r requirements.txt
```

## 3. Configure Environment Variables

Create `.env` in project root and add:

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4.1-mini
```

You can copy from template:

```powershell
Copy-Item .env.example .env
```

Then replace the API key value in `.env`.

## 4. Run the Server

Option A (recommended):

```powershell
.venv/Scripts/python.exe -m uvicorn server:app --reload
```

Option B:

```powershell
.venv/Scripts/python.exe server.py
```

Server runs at:

- http://127.0.0.1:8000

## 5. Verify Server Health

Open:

- http://127.0.0.1:8000/health

Expected response includes:

- `ok: true`
- selected `model`

## 6. Use the App

1. Open http://127.0.0.1:8000
2. Sign in with a demo user
3. Open Lumi Assistant and start chat

## Common Issues

- `OPENAI_API_KEY is not configured`
  - Ensure `.env` exists in project root and has `OPENAI_API_KEY`.

- `Import ... could not be resolved`
  - Reinstall dependencies with `-r requirements.txt` inside `.venv`.

- Chat says unable to connect
  - Ensure backend server is running on port `8000`.

## Security Notes

- Never commit `.env`.
- Rotate API keys if they were ever exposed.
- Keep `.env.example` as placeholder values only.
