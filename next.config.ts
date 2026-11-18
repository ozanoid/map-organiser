import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Plans were called trips until v1.37.0 and kept their ids; old links
      // and bookmarks still open the plan.
      { source: "/trips/:id", destination: "/plans/:id", permanent: true },
    ];
  },
};

export default nextConfig;
