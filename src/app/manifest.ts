import type { MetadataRoute } from "next";

// Web app manifest: what "Add to Home Screen" / "Install app" uses. Icons are
// the solid-orange logo on the dark surface colour (public/icons). No service
// worker and no push are registered anywhere — this is only the install
// metadata, the groundwork for push later.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Plataforma Coelho",
    short_name: "Coelho",
    description: "Organize sua rotina de estudos e acompanhe cada conquista.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0d0b0a",
    theme_color: "#0d0b0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
