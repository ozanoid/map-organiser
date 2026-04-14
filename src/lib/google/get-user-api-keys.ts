import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET environment variable is required");
  }
  return crypto.scryptSync(secret, "map-organiser-salt", 32);
}

export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptApiKey(encryptedStr: string): string {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedStr.split(":");
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return "";
  }
}

export interface UserApiKeys {
  googleApiKey: string;
  mapboxToken: string;
  isAdmin: boolean;
}

export async function getUserApiKeys(userId: string): Promise<UserApiKeys> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, google_api_key_enc, mapbox_token_enc")
    .eq("id", userId)
    .single();

  const isAdmin = profile?.is_admin || false;

  // Admin or no profile -> env vars
  if (isAdmin || !profile) {
    return {
      googleApiKey: process.env.GOOGLE_PLACES_API_KEY || "",
      mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "",
      isAdmin,
    };
  }

  // Decrypt user keys, fallback to empty string
  const googleApiKey = profile.google_api_key_enc
    ? decryptApiKey(profile.google_api_key_enc)
    : "";
  const mapboxToken = profile.mapbox_token_enc
    ? decryptApiKey(profile.mapbox_token_enc)
    : "";

  return { googleApiKey, mapboxToken, isAdmin };
}

// Mask a key for display: "AIzaSyBk...MEuI"
export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return key ? "********" : "";
  return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
}
