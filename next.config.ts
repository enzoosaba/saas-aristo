import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

// Permite abrir o dev server pelo celular na mesma rede sem fixar um IP,
// que muda a cada renovação de DHCP.
const localAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i!.address);
const nextConfig: NextConfig = {
  // "standalone" packages a self-contained server.js for the Docker/
  // scripts/start.mjs deployment path (see next.js's own deploying docs:
  // this output mode belongs to the "Docker" self-hosting path, distinct
  // from Vercel's own build adapter). Vercel does its own file tracing and
  // serverless packaging — combining the two makes its builder look for a
  // .nft.json trace file that "standalone" mode never produces in the
  // location Vercel expects, failing the build outright ("ENOENT ...
  // next-server.js.nft.json"). Vercel sets process.env.VERCEL during its
  // own build, so this only activates for the Docker path.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  serverExternalPackages: ["node:sqlite", "pg"],
  allowedDevOrigins: localAddresses,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
export default nextConfig;
