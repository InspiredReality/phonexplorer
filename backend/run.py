"""
Thin entry point — delegates to the app package.
Run locally:  python run.py
Production:   uvicorn app.main:app --host 0.0.0.0 --port $PORT
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
