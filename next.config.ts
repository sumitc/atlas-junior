import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // When deploying as a sub-path on Vercel (NEXT_PUBLIC_BASE_PATH=/game),
  // basePath ensures all internal links and asset URLs are prefixed correctly.
  // Leave unset for Capacitor APK builds (served from root of the webview).
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
};

export default nextConfig;
