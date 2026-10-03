import type { NextConfig } from "next";

// FastAPI backend (backend/app/main.py). Override with LAYA_API_URL if it runs elsewhere.
const API_URL = process.env.LAYA_API_URL ?? "http://127.0.0.1:8010";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
