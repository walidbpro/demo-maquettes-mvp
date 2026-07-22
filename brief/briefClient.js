// briefClient.js — client API de la modale « Confiez-nous votre besoin ».
// Contrat proxy : POST /brief  { briefId, mode, brief, attachmentBase64?, attachmentName? }
//   -> 2xx { ok, leadId, mocked? }   |   non-2xx { ok:false, error }
// Le front n'appelle JAMAIS Salesforce en direct : il passe par un proxy —
// backend local (localhost) ou Edge Function Supabase (déployé), cf. demoEnv.js.

import { BRIEF_ENDPOINT, ANALYSE_ENDPOINT, EXTRACTION_ENDPOINT, BRIEF_HEADERS } from "./demoEnv.js";

/** POST JSON avec erreurs en français : un échec RÉSEAU (fetch rejeté) sortait
 *  en « Failed to fetch » brut à l'écran (audit UX) — il porte désormais le même
 *  message actionnable que les réponses non-2xx sans détail. */
async function postJson(url, body, messageEchec) {
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: BRIEF_HEADERS, body: JSON.stringify(body) });
  } catch {
    throw new Error(messageEchec);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || messageEchec);
  return data;
}

/**
 * Analyse IA du brief en cours de saisie (brief PARTIEL accepté).
 * @returns {Promise<{ ok: boolean, analyse: {complet, alertes, suggestions}, source: "ia"|"regles" }>}
 */
export function analyseBrief({ mode, brief }) {
  return postJson(ANALYSE_ENDPOINT, { mode, brief }, "Analyse indisponible");
}

/**
 * Extraction IA d'un brief en texte libre → champs structurés (mêmes noms que
 * briefExtract.js). extraction === null → IA inactive : appliquer les règles locales.
 * @returns {Promise<{ ok: boolean, extraction: {mode, fields, residual}|null, source: "ia"|"regles" }>}
 */
export function extraireBrief({ texte }) {
  return postJson(EXTRACTION_ENDPOINT, { texte }, "Extraction indisponible");
}

/** Identifiant unique et idempotent du brief (sert de clé d'upsert côté SF). */
export function generateBriefId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `brief-${Date.now()}`;
}

/** Lit un File et renvoie son contenu encodé en base64 (sans le préfixe data:). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Soumet un brief au backend.
 * @param {{ mode: "delegue"|"portage", brief: object, file?: File|null }} args
 * @returns {Promise<{ ok: boolean, leadId: string, mocked?: boolean }>}
 */
export async function submitBrief({ mode, brief, file }) {
  const briefId = generateBriefId();
  const payload = { briefId, mode, brief };
  if (file) {
    payload.attachmentBase64 = await fileToBase64(file);
    payload.attachmentName = file.name;
  }
  return postJson(BRIEF_ENDPOINT, payload,
    "Impossible d'envoyer votre demande — vérifiez votre connexion puis réessayez.");
}
