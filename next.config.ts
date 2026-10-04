import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist", "jsdom", "@mozilla/readability", "playwright", "ipaddr.js"],
  poweredByHeader: false,
  experimental: { proxyClientMaxBodySize: "12mb" },
};

export default config;
