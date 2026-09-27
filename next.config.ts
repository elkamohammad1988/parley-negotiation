import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [375, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    minimumCacheTTL: 86400,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing in Parley uses the camera, the microphone or location.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS, in production only. A rehearsal transcript and a Supabase
          // access token both travel over this connection, and without this a
          // first request to http:// is downgradeable before the redirect.
          //
          // Withheld in development on purpose: browsers apply HSTS to
          // localhost too, and pinning it there would break every other
          // http://localhost project on the machine for the max-age.
          //
          // `preload` is deliberately NOT asserted. It is a request to be added
          // to a list browsers ship, removal from which takes months, and it
          // binds every subdomain of a production domain this repository does
          // not yet name. That is an owner decision, not a header default —
          // see the deployment notes in README.md.
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  },
  // `experimental.optimizeCss` was enabled here and is removed deliberately.
  // It routes rendering through Next's critical-CSS post-processor, which
  // requires the `critters` package — not installed — so every page it touched
  // returned a 500. It took out /library/[slug], the scenario brief, which is
  // the product's most important indexable page and the one a visitor lands on
  // from search. Removing the flag restores it and adds no dependency.
};

export default nextConfig;
