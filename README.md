# DHMIS Back Office

The tenant-facing back-office React application.

## Installation

Requirements: Node.js 20+ and a running DHMIS Backend.

```bash
cd back-office
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_API_BASE_URL` and the optional tenant defaults in `.env.local`. Build the production bundle with `npm run build`; preview it with `npm run preview`.

