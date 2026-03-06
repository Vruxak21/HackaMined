import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "150mb", // 100 MB file + ~33% base64 encoding overhead
    },
  },
};

export default nextConfig;
