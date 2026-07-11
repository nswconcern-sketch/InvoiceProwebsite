# Ledger — Invoicing website

React + Vite frontend for the invoicing app. Talks to the invoice-api
backend for customers and invoices; business info and exchange rates are
stored locally in the browser for now.

## Local setup

npm install
cp .env.example .env   # point VITE_API_BASE at your running backend
npm run dev

Make sure the invoice-api backend is running first — this app can't do
anything without it.

## Deploying to Vercel

1. Push this folder to a GitHub repo.
2. On Vercel: New Project → import the repo. Framework preset: Vite.
3. Add an environment variable: VITE_API_BASE = your Render API URL.
4. Deploy.
