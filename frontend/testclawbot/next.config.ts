import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN;
    if (!backendOrigin) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin.replace(/\/$/, "")}/api/:path*`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${backendOrigin.replace(/\/$/, "")}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
