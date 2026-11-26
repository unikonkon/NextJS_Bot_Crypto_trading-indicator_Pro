import type { MetadataRoute } from "next";

/** Install / home-screen info (served at /manifest.webmanifest) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "indicators",
    short_name: "indicators",
    description: "ทดสอบย้อนหลังและจัดอันดับ indicator เทรดคริปโตด้วยข้อมูลแท่งเทียน Binance",
    start_url: "/klines",
    display: "standalone",
    background_color: "#0a0e16",
    theme_color: "#0a0e16",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
