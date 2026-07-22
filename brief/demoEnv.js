// demoEnv.js — résolution d'environnement du front (zéro build : détection par hostname).
// SEULE définition des URLs/clés côté front (règle de cohérence 2 du design milestone B).
// La clé anon Supabase est publique par design — la sécurité vit dans RLS (ADR-017).
export const SUPABASE_URL = "https://sahprooloaxzmvbjmwlx.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhaHByb29sb2F4em12Ymptd2x4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5ODY2OTEsImV4cCI6MjA5ODU2MjY5MX0.sSl8N0-MPydOEylMHunZschQ_Mh44Kml_Mx6_wiidEE";

// Local (dev + jour J) → backend Fastify ; déployé (GitHub Pages) → Supabase.
export const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

export const BRIEF_ENDPOINT = IS_LOCAL
  ? `${window.BRIEF_BACKEND_URL || "http://localhost:3000"}/brief`
  : `${SUPABASE_URL}/functions/v1/brief`;

export const ANALYSE_ENDPOINT = IS_LOCAL
  ? `${window.BRIEF_BACKEND_URL || "http://localhost:3000"}/brief/analyse`
  : `${SUPABASE_URL}/functions/v1/brief-analyse`;

export const EXTRACTION_ENDPOINT = IS_LOCAL
  ? `${window.BRIEF_BACKEND_URL || "http://localhost:3000"}/brief/extraction`
  : `${SUPABASE_URL}/functions/v1/brief-extraction`;

export const BRIEF_HEADERS = IS_LOCAL
  ? { "Content-Type": "application/json" }
  : {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };
