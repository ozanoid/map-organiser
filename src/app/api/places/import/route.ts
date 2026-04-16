import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseTakeoutGeoJson, parseTakeoutCsv } from "@/lib/google/takeout-parser";
import { parseMapsUrl } from "@/lib/google/parse-maps-url";
import { resolveCategoryId } from "@/lib/google/category-mapping";
import { trackUsage } from "@/lib/google/track-usage";
import { DataForSEOClient } from "@/lib/dataforseo/client";
import { fetchBusinessInfoLive } from "@/lib/dataforseo/business-info";
import {
  transformBusinessInfoToPlaceData,
  extractExtendedData,
} from "@/lib/dataforseo/transform";
import { downloadAndStorePhotoFromUrl } from "@/lib/dataforseo/photo";

function extractCidFromUrl(url: string): string | null {
  const cidParam = url.match(/[?&]cid=(\d+)/);
  if (cidParam) return cidParam[1];
  const ftidMatch =
    url.match(/!1s0x[a-f0-9]+:(0x[a-f0-9]+)/) ||
    url.match(/ftid=0x[a-f0-9]+:(0x[a-f0-9]+)/);
  if (ftidMatch) {
    try {
      return BigInt(ftidMatch[1]).toString();
    } catch {}
  }
  return null;
}

function getDataForSEOClient(): DataForSEOClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return new DataForSEOClient({ login, password });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = getDataForSEOClient();
  if (!client) {
    return new Response(
      JSON.stringify({ error: "DataForSEO credentials not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const text = await file.text();
    const fileName = file.name.toLowerCase();
    const isCsv = fileName.endsWith(".csv");

    let places;
    if (isCsv) {
      places = parseTakeoutCsv(text);
    } else {
      const json = JSON.parse(text);
      places = parseTakeoutGeoJson(json);
    }

    if (places.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid places found in file" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch user categories for auto-categorization
    const { data: userCategories } = await supabase
      .from("categories")
      .select("*")
      .eq("user_id", user.id);

    const total = places.length;

    // Stream NDJSON progress to client
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let imported = 0;
        let failed = 0;
        let enriched = 0;
        const skipped: { name: string; url: string | null; reason: string }[] = [];
        const importedPlaceIds: string[] = [];

        // Send initial total
        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "start", total }) + "\n")
        );

        for (let i = 0; i < places.length; i++) {
          const p = places[i];
          try {
            let googleData: Record<string, unknown> = {};
            let googlePlaceId: string | null = null;
            let address = p.address;
            let country: string | null = null;
            let city: string | null = null;
            let lat = p.lat;
            let lng = p.lng;
            let categoryId: string | null = null;
            let photoRef: string | null = null;

            // Build DataForSEO keyword from URL or name
            let keyword: string = p.name;
            let locationCoordinate: string | undefined;

            if (p.googleMapsUrl) {
              const parsed = await parseMapsUrl(p.googleMapsUrl);
              const cid = extractCidFromUrl(p.googleMapsUrl);

              if (cid) {
                keyword = `cid:${cid}`;
              } else if (parsed.placeId) {
                keyword = `place_id:${parsed.placeId}`;
              } else if (parsed.query) {
                keyword = parsed.query;
              }

              // Use coords from URL or CSV for location bias
              const biasLat = parsed.lat || lat;
              const biasLng = parsed.lng || lng;
              if (biasLat && biasLng) {
                locationCoordinate = `${biasLat},${biasLng},1000`;
              }
            } else if (lat && lng) {
              locationCoordinate = `${lat},${lng},1000`;
            }

            // Fetch from DataForSEO
            const raw = await fetchBusinessInfoLive(client, {
              keyword,
              location_coordinate: locationCoordinate,
            });

            if (raw) {
              const placeData = transformBusinessInfoToPlaceData(raw);
              const extended = extractExtendedData(raw);

              googlePlaceId = placeData.placeId || null;
              address = placeData.address || address;
              country = placeData.country || country;
              city = placeData.city || city;
              lat = placeData.lat || lat;
              lng = placeData.lng || lng;
              photoRef = placeData.photoRef ?? null;

              googleData = {
                types: placeData.types,
                rating: placeData.rating,
                user_ratings_total: raw.rating?.votes_count,
                opening_hours: placeData.openingHours,
                website: placeData.website,
                phone: placeData.phone,
                price_level: placeData.priceLevel,
                url: placeData.googleMapsUrl,
                ...extended,
              };

              enriched++;

              // Auto-categorize
              if (placeData.types?.length && userCategories?.length) {
                categoryId = resolveCategoryId(
                  placeData.types,
                  userCategories,
                  p.name
                );
              }
            }

            await trackUsage(user.id, "dataforseo_business_info_live");

            // Skip if no valid coordinates
            if (!lat || !lng) {
              failed++;
              skipped.push({
                name: p.name,
                url: p.googleMapsUrl,
                reason: "No coordinates found",
              });
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: "progress",
                    current: i + 1,
                    total,
                    name: p.name,
                    status: "skipped",
                    reason: "No coordinates",
                  }) + "\n"
                )
              );
              continue;
            }

            // Duplicate check
            if (googlePlaceId) {
              const { data: existing } = await supabase
                .from("places")
                .select("id")
                .eq("user_id", user.id)
                .eq("google_place_id", googlePlaceId)
                .maybeSingle();

              if (existing) {
                failed++;
                skipped.push({
                  name: p.name,
                  url: p.googleMapsUrl,
                  reason: "Already exists",
                });
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      type: "progress",
                      current: i + 1,
                      total,
                      name: p.name,
                      status: "skipped",
                      reason: "Already exists",
                    }) + "\n"
                  )
                );
                continue;
              }
            }

            // Insert place
            const { data: insertedPlace, error } = await supabase
              .from("places")
              .insert({
                user_id: user.id,
                name: p.name,
                address,
                country,
                city,
                location: `POINT(${lng} ${lat})`,
                notes: p.note,
                google_place_id: googlePlaceId,
                google_data: googleData,
                category_id: categoryId,
                source: "import",
              })
              .select("id")
              .single();

            if (error || !insertedPlace) {
              failed++;
              skipped.push({
                name: p.name,
                url: p.googleMapsUrl,
                reason: error?.message || "Insert failed",
              });
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: "progress",
                    current: i + 1,
                    total,
                    name: p.name,
                    status: "skipped",
                    reason: error?.message || "Insert failed",
                  }) + "\n"
                )
              );
              continue;
            }

            // Download photo
            if (photoRef) {
              const storageUrl = await downloadAndStorePhotoFromUrl(
                photoRef,
                insertedPlace.id,
                user.id
              );
              if (storageUrl) {
                await supabase
                  .from("places")
                  .update({
                    google_data: { ...googleData, photo_storage_url: storageUrl },
                  })
                  .eq("id", insertedPlace.id);
              }
            }

            imported++;
            importedPlaceIds.push(insertedPlace.id);

            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "progress",
                  current: i + 1,
                  total,
                  name: p.name,
                  status: raw ? "enriched" : "imported",
                }) + "\n"
              )
            );

            // Rate limit: 100ms between DataForSEO calls
            await new Promise((r) => setTimeout(r, 100));
          } catch (err) {
            failed++;
            skipped.push({
              name: p.name,
              url: p.googleMapsUrl,
              reason: "Unknown error",
            });
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "progress",
                  current: i + 1,
                  total,
                  name: p.name,
                  status: "skipped",
                  reason: "Unknown error",
                }) + "\n"
              )
            );
          }
        }

        // Send final result
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "done",
              imported,
              failed,
              enriched,
              total,
              skipped,
              importedPlaceIds,
            }) + "\n"
          )
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    console.error("Import error:", error);
    return new Response(
      JSON.stringify({
        error:
          "Failed to parse file. Upload a GeoJSON or CSV from Google Takeout.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}
