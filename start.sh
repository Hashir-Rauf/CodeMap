#!/usr/bin/env bash
set -e

echo "=== CodeMap startup ==="

# 1. ChromaDB
echo "[1/3] Starting ChromaDB..."
docker compose up -d chroma
echo "      Waiting for Chroma to be ready..."
until curl -sf http://localhost:8001/api/v1/heartbeat > /dev/null; do sleep 1; done
echo "      Chroma OK"

# 2. Backend
echo "[2/3] Starting FastAPI backend..."
cd backend
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
cp -n .env.example .env 2>/dev/null || true
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "      Backend PID: $BACKEND_PID"
cd ..

# 3. Frontend
echo "[3/3] Starting Next.js frontend..."
cd frontend
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run dev &
FRONTEND_PID=$!
echo "      Frontend PID: $FRONTEND_PID"
cd ..

echo ""
echo "=== All services running ==="
echo "  Frontend:  http://localhost:3000"
echo "  Backend:   http://localhost:8000"
echo "  ChromaDB:  http://localhost:8001"
echo ""
echo "Press Ctrl+C to stop all services."

# Wait and clean up
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; docker compose stop chroma" EXIT INT TERM
wait
