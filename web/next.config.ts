import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/thaler";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: basePath === "/" ? "" : basePath,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BASE_PATH: basePath === "/" ? "" : basePath },
  webpack: (config) => {
    // wagmi/viem optional peer deps pulled in by some connectors
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
