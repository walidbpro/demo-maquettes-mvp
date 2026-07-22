// briefExtract.js — extraction déterministe d'un brief en texte libre (règles FR).
// Module pur (zéro DOM) : consommé par brief.html, testé par backend/test/briefExtract.test.ts.
// Arbitrage A-5 de la spec : règles locales (RGPD : aucun texte transmis à un tiers).
// Dette nommée : en production réelle, extraction LLM côté backend — l'interface
// extract(text) → { mode, fields } resterait identique.
// La détection est générique (tous les champs détectables sont retournés) ; l'UI filtre.

import { SKILLS } from "./skillsFreework.js";

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const TEL_RE = /(?:\+33\s?|0)[1-9](?:[ .]?\d{2}){4}/;
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];

// Lexiques volontairement courts : non détecté → champ à compléter (spec §6).
const VILLES = ["Paris", "Lyon", "Marseille", "Toulouse", "Bordeaux", "Nantes",
  "Lille", "Rennes", "Strasbourg", "Nice", "Grenoble", "Montpellier"];
const METIERS = [
  ["testeur", "Testeur"], ["qa", "QA"],
  ["développeur", "Développeur"], ["développeuse", "Développeuse"],
  ["dev", "Développeur"], // abréviation courante (répétition démo 2026-07-03)
  ["po", "Product owner"], // idem (anomalie terrain 2026-07-03 : « je cherche un PO »)
  ["chef de projet", "Chef de projet"], ["product owner", "Product owner"],
  ["scrum master", "Scrum master"], ["data engineer", "Data engineer"],
  ["data scientist", "Data scientist"], ["data analyst", "Data analyst"],
  ["architecte", "Architecte"], ["devops", "DevOps"],
  ["designer", "Designer"], ["ux", "UX"],
];
const TECHNOS = [
  ["node.js", "Node.js"], ["nodejs", "Node.js"], ["node", "Node.js"],
  ["typescript", "TypeScript"], ["javascript", "JavaScript"], ["java", "Java"],
  ["python", "Python"], ["react", "React"], ["vue", "Vue"], ["angular", "Angular"],
  ["aws", "AWS"], ["azure", "Azure"], ["kubernetes", "Kubernetes"], ["docker", "Docker"],
  ["salesforce", "Salesforce"], ["sap", "SAP"], ["sql", "SQL"],
];
const SECTEURS = [
  ["banque", "Banque"], ["assurance", "Assurance"], ["retail", "Retail"],
  ["santé", "Santé"], ["énergie", "Énergie"], ["industrie", "Industrie"],
  ["luxe", "Luxe"], ["télécom", "Télécoms"], ["secteur public", "Secteur public"],
  ["transport", "Transport"],
];

// Mots « techniques » en minuscules (référentiel FreeWork + lexiques locaux,
// entrées multi-mots décomposées) : jamais des noms de personnes — garde-fou
// de detectIntervenant.
const SKILL_WORDS = new Set([
  ...SKILLS.flatMap((s) => s.toLowerCase().split(/\s+/)),
  ...[...METIERS, ...TECHNOS].flatMap(([k, label]) =>
    [...k.split(/\s+/), ...label.toLowerCase().split(/\s+/)]),
]);

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matchLexicon = (t, pairs) =>
  pairs.filter(([key]) => new RegExp(`(?<!\\p{L})${escapeRe(key)}(?!\\p{L})`, "iu").test(t));

function detectMode(t) {
  // « je connais / il s'appelle X » : la personne est identifiée → portage
  // (anomalie terrain 2026-07-02 : capture Walid, mode non détecté).
  if (/portage|intervenant|déjà identifié|je connais|s['’]appell?e/i.test(t) || EMAIL_RE.test(t)) return "portage";
  if (/recherch|cherch|besoin d|recrut|je veux|nous voulons|on veut|il (?:me|nous) faut/i.test(t)) return "delegue";
  return null;
}

function detectStartDate(t, now) {
  const jma = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (jma) return `${jma[3]}-${pad(+jma[2])}-${pad(+jma[1])}`;
  const mois = t.toLowerCase().match(new RegExp(`(?<!\\p{L})(${MOIS.join("|")})(?!\\p{L})(?:\\s+(\\d{4}))?`, "u"));
  if (mois) {
    const m = MOIS.indexOf(mois[1]);
    const y = mois[2] ? +mois[2] : m >= now.getMonth() ? now.getFullYear() : now.getFullYear() + 1;
    return `${y}-${pad(m + 1)}-01`;
  }
  // Dates relatives (l'ordre compte : « après-demain » contient « demain »).
  const relative = /après-demain/i.test(t) ? 2
    : /(?<!\p{L})demain(?!\p{L})/iu.test(t) ? 1
    : /semaine prochaine/i.test(t) ? 7
    : null;
  if (relative !== null) {
    const d = new Date(now);
    d.setDate(d.getDate() + relative);
    return iso(d);
  }
  // « ce lundi / mardi prochain / démarrage vendredi » → prochaine occurrence du
  // jour (le jour courant renvoie à la semaine suivante). Campagne 2026-07-03.
  const jour = t.toLowerCase().match(/(?<!\p{L})(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?!\p{L})/u);
  if (jour) {
    const cible = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"].indexOf(jour[1]);
    const d = new Date(now);
    d.setDate(d.getDate() + (((cible - d.getDay()) + 7) % 7 || 7));
    return iso(d);
  }
  if (/asap|d[eè]s que possible|au plus vite|imm[ée]diat/i.test(t)) {
    // « Trop lointain » à J+14 (retour répétition démo) → prochain jour OUVRÉ.
    const d = new Date(now);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return iso(d);
  }
  return undefined;
}

function detectDuree(t) {
  // « N ans d'expérience » est une expérience, pas une durée : on l'exclut.
  const m = t.replace(/\d{1,2}\s*ans\s+d['’]exp[ée]rience/gi, "").match(/(\d+)\s*(mois|semaines?|jours?|ans?\b|années?)/i);
  if (!m) return {};
  const u = m[2].toLowerCase();
  const unite = u.startsWith("mois") ? "mois"
    : u.startsWith("semaine") ? "semaines"
    : u.startsWith("jour") ? "jours" : "années";
  return { duree: Number(m[1]), unite };
}

function detectTjm(t) {
  // « entre X et Y € » : la devise sur la borne haute évite « entre 3 et 6 mois ».
  const range = t.match(/entre\s+(\d{2,5})\s*(?:€|euros?)?\s+et\s+(\d{2,5})\s*(?:€|euros?)/i);
  if (range) return { tjmMin: +range[1], tjmMax: +range[2], tjm: +range[2] };
  const max = t.match(/(?:tjm|budget)\s+max(?:imum)?\s*(?:à|de|:)?\s*(\d{2,5})/i);
  if (max) return { tjmMax: +max[1], tjm: +max[1] };
  const one = t.match(/tjm\s*(?:à|de|:)?\s*(\d{2,5})|(\d{2,5})\s*(?:€|euros?)/i);
  if (one) {
    const v = +(one[1] || one[2]);
    return { tjmMax: v, tjm: v };
  }
  return {};
}

function detectDevise(t) {
  if (/\$|usd/i.test(t)) return "USD";
  if (/£|gbp/i.test(t)) return "GBP";
  if (/€|euros?\b|eur\b/i.test(t)) return "EUR";
  return undefined;
}

function detectLocalisation(t) {
  const ville = VILLES.find((v) => new RegExp(`(?<!\\p{L})${v}(?!\\p{L})`, "iu").test(t));
  // « dans le 78 / sur le 92 » : numéro de département (une ville explicite prime) ;
  // la garde (?!\s*€|\s*euros) évite de prendre « sur le 400 euros » pour un lieu.
  const dep = ville ? null : t.match(/(?:dans|sur)\s+le\s+(\d{2,3})(?!\d)(?!\s*(?:€|euros?))/i);
  const remote = /remote|télétravail|à distance/i.test(t);
  const parts = [ville || (dep ? `département ${dep[1]}` : null), remote ? "télétravail" : null].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function detectRythme(t) {
  const njs = t.match(/(\d)\s*j(?:ours?)?\s*\/\s*sem/i);
  if (njs) return `${njs[1]}j/sem`;
  if (/temps plein|plein temps/i.test(t)) return "Temps plein";
  if (/temps partiel|mi-temps/i.test(t)) return "Temps partiel";
  return undefined;
}

// Expérience : « N ans d'expérience » (explicite) ou mot de séniorité.
// « pour 2 ans » sans « expérience » = durée, pas expérience.
function detectExperience(t) {
  const ans = t.match(/(\d{1,2})\s*ans\s+d['’]exp/i);
  if (ans) return `${+ans[1]} ans`;
  const mot = t.match(/(?<!\p{L})(junior|débutante?|confirmée?|senior|exp[ée]riment[ée]e?|experte?)(?!\p{L})/iu);
  if (mot) {
    const raw = mot[1].toLowerCase();
    const base = raw.startsWith("junior") ? "Junior"
      : raw.startsWith("débutant") ? "Débutant"
      : raw.startsWith("confirmé") ? "Confirmé"
      : raw.startsWith("senior") ? "Senior"
      // « expérimenté » (accent facultatif : faute de frappe fréquente) → Senior via experienceToNiveau
      : /^exp[ée]riment/.test(raw) ? "Expérimenté" : "Expert";
    return base;
  }
  return undefined;
}

// Mapping expérience brute → enum niveau du contrat (aussi utilisé par le bloc
// dynamique de brief.html pour une saisie manuelle type « 5 ans » ou « senior »).
export function experienceToNiveau(raw) {
  const s = String(raw || "");
  const n = s.match(/(\d{1,2})/);
  if (n) {
    const v = +n[1];
    return v <= 2 ? "Débutant (0-2)" : v <= 5 ? "Confirmé (3-5)" : v <= 9 ? "Senior (6-9)" : "Expert (10+)";
  }
  if (/expert/i.test(s)) return "Expert (10+)";
  if (/senior|expériment/i.test(s)) return "Senior (6-9)";
  if (/confirmé/i.test(s)) return "Confirmé (3-5)";
  if (/junior|débutant/i.test(s)) return "Débutant (0-2)";
  return undefined;
}

// Référentiel FreeWork (skillsFreework.js) : compétences détectées dans le texte.
// indexOf borné (pas de lettre/chiffre autour) ; les libellés les plus longs d'abord
// pour qu'un match court inclus dans un plus long ("JS" dans "Node.js") soit ignoré.
const SKILLS_BY_LEN = [...SKILLS].sort((a, b) => b.length - a.length);
const isWordChar = (c) => c !== undefined && /[\p{L}\d]/u.test(c);
function findReferentialSkills(t) {
  // Les expressions du mode de sourcing ne sont pas des compétences : « commercial »
  // ne doit pas matcher dans « portage commercial ». Masquées à positions constantes.
  const lower = t.toLowerCase()
    .replace(/portage\s+commercial|sourcing\s+délégué/g, (m) => " ".repeat(m.length));
  const found = [];
  const taken = [];
  for (const skill of SKILLS_BY_LEN) {
    if (skill.length < 2) continue; // libellés d'une lettre : trop de faux positifs
    const k = skill.toLowerCase();
    let i = lower.indexOf(k);
    while (i !== -1) {
      const covered = taken.some(([a, b]) => i >= a && i + k.length <= b);
      if (!covered && !isWordChar(lower[i - 1]) && !isWordChar(lower[i + k.length])) {
        found.push({ skill, start: i, end: i + k.length });
        taken.push([i, i + k.length]);
        break;
      }
      i = lower.indexOf(k, i + 1);
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

// Intitulé composé « rôle + techno » : « expert Salesforce », « Salesforce Expert »,
// « consultante SAP », « spécialiste en Kubernetes »… (anomalie terrain 2026-07-03).
// Rôles absents du lexique METIERS uniquement — un métier du lexique garde la priorité.
const ROLES_COMPOSES = [
  ["experte?", "Expert"], ["sp[ée]cialiste", "Spécialiste"],
  ["consultante?", "Consultant"], ["ing[ée]nieure?", "Ingénieur"],
];
const TECHNO_ALT = TECHNOS.map(([k]) => escapeRe(k)).join("|");
function detectPosteCompose(t) {
  for (const [role, roleLabel] of ROLES_COMPOSES) {
    const re = new RegExp(
      `(?<!\\p{L})(?:${role})\\s+(?:en\\s+|sur\\s+)?(${TECHNO_ALT})(?!\\p{L})` +
      `|(?<!\\p{L})(${TECHNO_ALT})\\s+(?:${role})(?!\\p{L})`, "iu");
    const m = t.match(re);
    if (m) {
      const key = (m[1] || m[2]).toLowerCase();
      const techno = TECHNOS.find(([k]) => k === key)?.[1] ?? (m[1] || m[2]);
      return `${roleLabel} ${techno}`;
    }
  }
  return undefined;
}

function detectIntervenant(t) {
  const out = {};
  const email = t.match(EMAIL_RE);
  if (email) out.intervenantEmail = email[0];
  const tel = t.match(TEL_RE);
  if (tel) out.intervenantTel = tel[0].trim();
  // Heuristique : nom capitalisé après « avec / consultant(e) / intervenant(e) /
  // ressource / freelance / connais / contacter » (anomalies terrain 2026-07-03 :
  // « je connais une ressource Pierre Rabouin », « je connais Pierre Rabouin »,
  // puis « Contacter Marie Lagrand » — verbe en tête de phrase, donc capitalisé).
  // Garde-fou : un mot du référentiel skills (Scrum, React…) n'est jamais un nom.
  const nom = t.match(/(?:avec|consultante?|intervenante?|ressource|freelance|connais|[Cc]ontacte[rz]?)\s+([A-ZÀ-Ý][a-zà-ÿ-]+(?:\s+[A-ZÀ-Ý][A-Za-zà-ÿ.-]*)?)/);
  if (nom) {
    const mots = nom[1].trim().split(/\s+/).filter((w) => !SKILL_WORDS.has(w.toLowerCase()));
    if (mots.length) out.intervenantNom = mots.join(" ");
  }
  // « il s'appelle robert laputa » : le nom vient souvent SANS majuscules dans un
  // texte tapé vite (anomalie terrain 2026-07-02) — capture tolérante + Title Case.
  if (!out.intervenantNom) {
    const appelle = t.match(/s['’]appell?e\s+(\p{L}[\p{L}-]*(?:\s+\p{L}[\p{L}-]*)?)/iu);
    if (appelle) {
      out.intervenantNom = appelle[1].trim().split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }
  return out;
}

// ---------- Reliquat (modale v3) : ce que la détection n'a PAS consommé ----------
// Sert à décider d'afficher le champ « Commentaire » (et à le pré-remplir) : si le
// texte contient des éléments au-delà des champs mappés, ils ressortent ici.
const STOPWORDS = new Set([
  "le", "la", "les", "l", "un", "une", "des", "de", "du", "d", "et", "ou", "où",
  "pour", "avec", "sans", "sur", "dans", "en", "à", "au", "aux", "ce", "cet",
  "cette", "ces", "se", "sa", "son", "ses", "leur", "leurs", "notre", "nos",
  "votre", "vos", "il", "elle", "ils", "elles", "on", "nous", "vous", "je", "tu",
  "qui", "que", "quoi", "dont", "est", "sont", "être", "avoir", "a", "ont",
  "avons", "avez", "très", "plus", "bien", "tout", "toute", "tous", "comme",
  "mais", "donc", "alors", "aussi",
]);

// Mots outils du domaine : présents dans quasi tous les briefs, ils accompagnent
// une info déjà mappée (« profil senior », « démarrage asap ») — pas un reliquat.
const DOMAIN_FILLERS =
  /(?<!\p{L})(profil|mission|poste|consultante?|sp[ée]cialiste|ing[ée]nieure?|freelance|prestataire|secteur|expérience)(?!\p{L})/giu;

function consumedPatterns() {
  return [
    new RegExp(EMAIL_RE.source, "g"),
    new RegExp(TEL_RE.source, "g"),
    /\d{1,2}\/\d{1,2}\/\d{4}/g,
    new RegExp(`(?<!\\p{L})(${MOIS.join("|")})(?!\\p{L})(?:\\s+\\d{4})?`, "giu"),
    /après-demain|(?<!\p{L})demain(?!\p{L})|semaine prochaine/giu,
    /(?<!\p{L})(?:dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)(?!\p{L})(?:\s+prochaine?)?/giu,
    /(?:ce\s+)?(?<!\p{L})(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?!\p{L})(?:\s+prochaine?)?/giu,
    /asap|d[eè]s que possible|au plus vite|imm[ée]diat(?:ement)?/gi,
    /\d{1,2}\s*ans\s+d['’]exp[ée]rience/gi,
    /(?<!\p{L})(junior|débutante?|confirmée?|senior|exp[ée]riment[ée]e?|experte?)(?!\p{L})/giu,
    /entre\s+\d{2,5}\s*(?:€|euros?)?\s+et\s+\d{2,5}\s*(?:€|euros?)/gi,
    /(?:tjm|budget)\s+max(?:imum)?\s*(?:à|de|:)?\s*\d{2,5}/gi,
    /tjm\s*(?:à|de|:)?\s*\d{2,5}/gi,
    /\d{2,5}\s*(?:€|euros?|\$|usd|£|gbp)/gi,
    /(?<!\p{L})(tjm|budget)(?!\p{L})/gi,
    /\d+\s*(?:mois|semaines?|jours?|ans?\b|années?)/gi,
    /\dj\s*\/\s*sem\w*/gi,
    /temps plein|plein temps|temps partiel|mi-temps/gi,
    /remote|télétravail|à distance/gi,
    /(?:dans|sur)\s+le\s+\d{2,3}(?!\d)/gi,
    /portage(?:\s+commercial)?|sourcing(?:\s+délégué)?|intervenant[es]?|déjà identifié|je connais/gi,
    /s['’]appell?e\s+\p{L}[\p{L}-]*(?:\s+\p{L}[\p{L}-]*)?/giu,
    // Nom capitalisé après une amorce d'intervenant (aligné sur detectIntervenant)
    /(?:avec|consultante?|intervenante?|ressource|freelance|connais|[Cc]ontacte[rz]?)\s+[A-ZÀ-Ý][a-zà-ÿ-]+(?:\s+[A-ZÀ-Ý][A-Za-zà-ÿ.-]*)?/g,
    /recherch\w+|cherch\w+|recrut\w+|(?<!\p{L})besoin(?!\p{L})/giu,
    /démarr\w+|commenc\w+|début\w*/gi,
    DOMAIN_FILLERS,
    ...[...METIERS, ...TECHNOS, ...SECTEURS].map(([k]) =>
      new RegExp(`(?<!\\p{L})${escapeRe(k)}(?!\\p{L})`, "giu")),
    ...VILLES.map((v) => new RegExp(`(?<!\\p{L})${escapeRe(v)}(?!\\p{L})`, "giu")),
  ];
}

const bareWord = (tok) => tok.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
const isContentWord = (tok) => {
  const w = bareWord(tok).toLowerCase();
  return w.length >= 3 && !STOPWORDS.has(w);
};

function computeResidual(t, extraRanges = []) {
  const ranges = [...extraRanges];
  for (const re of consumedPatterns()) {
    for (const m of t.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
  }
  const consumed = (start, end) => ranges.some(([a, b]) => start < b && end > a);
  // Fragments = suites de mots non consommés ; la ponctuation forte sépare.
  const fragments = [];
  let current = [];
  const flush = () => {
    // Un fragment ne compte que s'il porte ≥ 2 mots « pleins » (ni vides ni outils).
    if (current.filter(isContentWord).length >= 2) {
      while (current.length && !isContentWord(current[current.length - 1])) current.pop();
      fragments.push(current.map(bareWord).join(" "));
    }
    current = [];
  };
  for (const m of t.matchAll(/\S+/g)) {
    const tok = m[0];
    // Token consommé ou ponctuation pure → frontière de fragment.
    if (consumed(m.index, m.index + tok.length) || bareWord(tok) === "") {
      flush();
      continue;
    }
    if (/[.,;:!?]$/.test(tok)) { current.push(tok); flush(); continue; }
    current.push(tok);
  }
  flush();
  return fragments.join(" … ");
}

// Lettres O tapées à la place des zéros (« 6OO € » — frappe rapide, répétition
// démo 2026-07-03) : normalisées dans tout token contenant au moins un chiffre.
function normalizeChiffres(s) {
  return s.replace(/[0-9oO]{2,}/g, (tok) => (/\d/.test(tok) ? tok.replace(/[oO]/g, "0") : tok));
}

export function extract(text, { now = new Date() } = {}) {
  const t = normalizeChiffres((text || "").trim());
  if (!t) return { mode: null, fields: {}, residual: "" };
  const fields = {};
  const set = (k, v) => { if (v !== undefined) fields[k] = v; };
  const metiers = matchLexicon(t, METIERS);
  set("poste", metiers[0]?.[1] ?? detectPosteCompose(t));
  const refSkills = findReferentialSkills(t);
  const competences = [];
  const seenComp = new Set();
  for (const label of [...[...metiers, ...matchLexicon(t, TECHNOS)].map(([, l]) => l),
                       ...refSkills.map((r) => r.skill)]) {
    const k = label.toLowerCase();
    if (!seenComp.has(k)) { seenComp.add(k); competences.push(label); }
  }
  set("competences", competences.length ? competences.join(", ") : undefined);
  set("secteur", matchLexicon(t, SECTEURS)[0]?.[1]);
  const experience = detectExperience(t);
  set("experience", experience);
  set("niveau", experience ? experienceToNiveau(experience) : undefined);
  set("startDate", detectStartDate(t, now));
  Object.assign(fields, detectDuree(t));
  set("localisation", detectLocalisation(t));
  set("rythme", detectRythme(t));
  set("devise", detectDevise(t));
  Object.assign(fields, detectTjm(t));
  Object.assign(fields, detectIntervenant(t));
  // Un intervenant identifié (nom/e-mail/téléphone) = portage, même sans mot-clé
  // (« Mission avec Jean Dupont… » — bug de la répétition démo 2026-07-03).
  const mode = detectMode(t)
    ?? (fields.intervenantNom || fields.intervenantEmail || fields.intervenantTel ? "portage" : null);
  return { mode, fields, residual: computeResidual(t, refSkills.map((r) => [r.start, r.end])) };
}
