import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["admin.localhost", "admin.127.0.0.1"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.cavbot.io",
      },
      {
        protocol: "https",
        hostname: "www.w3.org",
      },
    ],
  },
  webpack(config, { dev, isServer }) {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve(process.cwd()),
    };
    // Prevent false-positive ChunkLoadError timeouts during heavy dev recompiles.
    if (dev && !isServer && config.output) {
      config.output.chunkLoadTimeout = 300000; // 5 minutes
    }
    return config;
  },
  async redirects() {
    return [
      {
        source: "/command-center",
        destination: "/",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/cavai/cavai-analytics-v5.js",
        destination: "https://cdn.cavbot.io/sdk/v5/cavai-analytics-v5.min.js",
      },
      {
        source: "/cavai/cavai.js",
        destination: "https://cdn.cavbot.io/sdk/cavai/v1/cavai.min.js",
      },
      {
        source: "/cavbot/widget/cavbot-widget.js",
        destination: "https://cdn.cavbot.io/sdk/widget/v1/cavbot-widget.min.js",
      },
      {
        source: "/cavbot/arcade/loader.js",
        destination: "https://cdn.cavbot.io/sdk/arcade/v1/loader.min.js",
      },
      {
        source: "/cavbot/badge/cavbot-badge-inline.css",
        destination: "https://cdn.cavbot.io/sdk/ui/v1/cavbot-badge-inline.css",
      },
      {
        source: "/cavbot/badge/cavbot-badge-ring.css",
        destination: "https://cdn.cavbot.io/sdk/ui/v1/cavbot-badge-ring.css",
      },
      {
        source: "/cavbot/head/cavbot-head-orbit.css",
        destination: "https://cdn.cavbot.io/sdk/ui/v1/cavbot-head-orbit.css",
      },
      {
        source: "/cavbot/body/cavbot-full-body.css",
        destination: "https://cdn.cavbot.io/sdk/ui/v1/cavbot-full-body.css",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(self)" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        ],
      },
      {
        source: "/auth",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: "/users/recovery/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: "/settings/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: "/api/verify/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: "/",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
      {
        source: "/cavbot-arcade/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
      {
        source: "/api/embed/arcade/signed/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
      {
        source: "/cavcode/sw/mount-runtime.js",
        headers: [
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
