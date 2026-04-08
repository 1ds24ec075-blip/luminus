# DEPLOYMENT GUIDE for Luminus Demo

## Option 1: Railway.app (RECOMMENDED - Easiest)

### Prerequisites:
- GitHub account: https://github.com/signup (free)
- Git installed: https://git-scm.com/

### Step 1: Push to GitHub
```powershell
cd d:\luminus
git init
git add .
git commit -m "Luminus hackathon demo - ready for deployment"
git remote add origin https://github.com/YOUR_USERNAME/luminus.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy on Railway
1. Go to: https://railway.app/
2. Click "Sign up with GitHub" → Authorize
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Choose your `luminus` repository
6. Railway auto-detects Python
7. Click "Deploy Now"
8. **Wait 2-3 minutes** → Railway builds & deploys
9. Copy the public URL from Railway dashboard (e.g., `https://luminus-abc123.railway.app`)

### Step 3: Add Environment Variables
1. In Railway dashboard, go to your project
2. Click "Variables" tab
3. Add these:
   - Key: `OPENAI_API_KEY` | Value: `sk-proj-...` (your OpenAI key)
   - Key: `GEMINI_API_KEY` | Value: `... (optional)`
   - Key: `GROQ_API_KEY` | Value: `... (optional)`
4. Click "Deploy" again (redeploy with new env vars)
5. Wait 1-2 minutes

### Step 4: Test It
- Open: `https://luminus-abc123.railway.app/health`
- Should return: `{"ok": true, ...}`
- Then open: `https://luminus-abc123.railway.app/` for full UI

✅ **DONE!** Your demo is now live on the internet.

---

## Presenting the Demo

### For Judges:
1. Test it first: `https://luminus-abc123.railway.app/`
2. Open 3 browser tabs with the public URL (no localhost conflicts!)
3. Follow the demo script in HACKATHON_TEST_CASES.txt

### Multiple Judges Can Access Simultaneously:
- Judge 1: Open tab with patient URL
- Judge 2: Open tab with admin URL
- Judge 3: Open tab with doctor URL
- All on **different devices** but same **public URL**

---

## Option 2: Render.com

1. Go to: https://render.com/
2. Sign up with GitHub
3. Click "New" → "Web Service"
4. Connect your GitHub `luminus` repo
5. Set Python runtime
6. Render deploys automatically
7. Get public URL

---

## Troubleshooting

**"Module not found" error?**
- Add missing packages to `requirements.txt`
- Redeploy

**"Database error" on deployment?**
- SQLite needs to initialize fresh on first run (automatic)
- No action needed

**"Can't access the URL"?**
- Wait 5 minutes for deployment to complete
- Check deployment logs in Railway/Render dashboard

---

## Quick Comparison

| Platform | Setup Time | Cost | Ease |
|----------|-----------|------|------|
| **Railway** | 5 min | Free tier | ⭐⭐⭐⭐⭐ |
| **Render** | 5 min | Free tier | ⭐⭐⭐⭐⭐ |
| **Heroku** | 5 min | Paid (no free tier) | ⭐⭐⭐ |
| **AWS/Azure** | 30 min | Pay-as-you-go | ⭐⭐ |

---

**For a hackathon? Railway all the way.** 🚀
