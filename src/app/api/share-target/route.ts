import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const url = formData.get("url") as string;
  const text = formData.get("text") as string;
  const title = formData.get("title") as string;

  // Extract URL from shared content
  const sharedUrl = url || text || "";
  const mapsUrlMatch = sharedUrl.match(
    /https?:\/\/(www\.)?(google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s]*/
  );

  if (mapsUrlMatch) {
    const encodedUrl = encodeURIComponent(mapsUrlMatch[0]);
    return NextResponse.redirect(
      new URL(`/map?add=${encodedUrl}`, request.url)
    );
  }

  // If no Google Maps URL found, redirect to map
  return NextResponse.redirect(new URL("/map", request.url));
}
