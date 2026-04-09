import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Map Organiser",
    short_name: "MapOrg",
    description: "Organize your saved Google Maps locations",
    start_url: "/map",
    display: "standalone",
    background_color: "#FAFAFA",
    theme_color: "#059669",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    share_target: {
      action: "/api/share-target",
      method: "POST",
      enctype: "application/x-www-form-urlencoded",
      params: {
        url: "url",
        text: "text",
        title: "title",
      },
    },
  };
}
