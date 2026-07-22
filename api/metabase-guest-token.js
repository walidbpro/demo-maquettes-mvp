const crypto = require("node:crypto");

const DASHBOARD_ID = 33;
const TOKEN_TTL_SECONDS = 10 * 60;

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signGuestToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      resource: { dashboard: DASHBOARD_ID },
      params: {},
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    }),
  );
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

module.exports = (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.METABASE_EMBEDDING_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Metabase embedding is not configured" });
  }

  // The browser never chooses which Metabase resource is signed.
  const { entityType, entityId } = req.body || {};
  if (entityType !== "dashboard" || Number(entityId) !== DASHBOARD_ID) {
    return res.status(400).json({ error: "Dashboard not allowed" });
  }

  return res.status(200).json({ jwt: signGuestToken(secret) });
};
