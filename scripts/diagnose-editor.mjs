// Diagnose the embedded-editor 401 using the LOCAL .env.local — prints no secrets.
// Run: node --env-file=.env.local scripts/diagnose-editor.mjs acme
import jwt from "jsonwebtoken";

const slug = (process.argv[2] || "acme").toUpperCase();
const P = `SUPRSEND_${slug}`;
const key = process.env[`${P}_WORKSPACE_KEY`] || "";
const sigId = process.env[`${P}_SIGNING_KEY_ID`] || "";
const sigB64 = process.env[`${P}_SIGNING_KEY_B64`] || "";
const mgmt = (process.env.SUPRSEND_MGMNT_URL || "https://management-api.suprsend.com").replace(/\/$/, "");

console.log("WORKSPACE_KEY  :", key ? `set (${key.length} chars)` : "MISSING");
console.log("SIGNING_KEY_ID :", sigId ? `"${sigId}"` : "MISSING");
console.log("  → looks like:", sigId.startsWith("signing_key_") ? "UID ✅ (correct form)" : sigId.startsWith("ws_signk_") ? "the ws_signk_ ID ❌ (should be the signing_key_ UID)" : "unexpected");
console.log("SIGNING_KEY_B64:", sigB64 ? `set (${sigB64.length} chars)` : "MISSING");

let pem = "";
try {
  pem = Buffer.from(sigB64, "base64").toString("utf-8");
  console.log("private key    :", /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem) ? "valid PEM ✅" : "NOT a PEM ❌");
} catch { console.log("private key    : B64 decode failed ❌"); }

const now = Math.floor(Date.now() / 1000);
const token = jwt.sign(
  { workspace_uid: key, entity_type: "template", entity_id: "*", iat: now, exp: now + 3600, scope: { variant_scope: {}, recipients: [{ distinct_id: "preview-user" }] } },
  pem, { algorithm: "ES256", header: { alg: "ES256", typ: "JWT", kid: sigId } },
);
const url = `${mgmt}/v2/${key}/template/tasks-upcoming/embedded/channel/email/variant/default/?tenant_id=null&locale=en&conditions=%5B%5D&mode=live&variant_id=default`;
const res = await fetch(url, { headers: { Authorization: `EmbeddedToken ${token}` } });
console.log(`\nSERVER → HTTP ${res.status}`);
console.log("  body:", (await res.text()).slice(0, 300));
console.log("\n200 = editor will work.  'invalid JWT kid-header' = SIGNING_KEY_ID is wrong (use the signing_key_ UID).  'signature' = B64 doesn't match that key.");
