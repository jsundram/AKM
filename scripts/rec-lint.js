#!/usr/bin/env node
// Warn (never block) when recordings.enc.js is STALE — i.e. it doesn't decrypt to the current
// recordings.json. That's the one drift the build can't self-heal: you edit links (or add a concert
// to concert-data.js and regenerate recordings.json) but forget to re-run build-recordings.js, so the
// shipped ciphertext lags the data. Mirrors sw-lint's philosophy (prints findings, exit 1 for the
// hook's `||` nudge; a plain run is warn-only). Skips cleanly (exit 0) when it can't check:
//   - no recordings.json (the plaintext lives outside most clones) → nothing to compare against
//   - no REC_PW (env or .env) → can't decrypt, so can't compare
// So it only ever fires on the machine that actually holds the links + password — exactly where a
// forgotten rebuild happens. Node (not python like the other lints) because it needs WebCrypto + the
// blob format. Run by hand for a real exit code:  node scripts/rec-lint.js
const fs = require("fs");
const path = require("path");
const { webcrypto: wc } = require("crypto");

const root = path.join(__dirname, "..");
const rd = f => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return null; } };

function pw(){
  if(process.env.REC_PW) return process.env.REC_PW;
  const env = rd(".env"); if(!env) return null;
  const m = env.match(/^\s*REC_PW\s*=\s*(.*)$/m); if(!m) return null;
  let v = m[1].trim();
  if(v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
  return v || null;
}

(async () => {
  const jsonTxt = rd("recordings.json"), encTxt = rd("recordings.enc.js"), secret = pw();
  if(!jsonTxt || !encTxt || !secret) process.exit(0);      // can't check here — stay quiet

  const m = encTxt.match(/window\.RecEnc\s*=\s*(\{[\s\S]*?\});/);
  if(!m){ console.warn("rec-lint: recordings.enc.js has no RecEnc blob — rebuild it (node scripts/build-recordings.js)"); process.exit(1); }
  const blob = JSON.parse(m[1].replace(/(\w+):/g, '"$1":'));
  const dec = s => Uint8Array.from(Buffer.from(s, "base64"));
  let got;
  try {
    const km = await wc.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
    const key = await wc.subtle.deriveKey({ name: "PBKDF2", salt: dec(blob.salt), iterations: blob.iter, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const pt = await wc.subtle.decrypt({ name: "AES-GCM", iv: dec(blob.iv) }, key, dec(blob.ct));
    got = JSON.parse(new TextDecoder().decode(pt));
  } catch {
    console.warn("rec-lint: recordings.enc.js won't decrypt with the .env password — rebuild it, or check REC_PW.");
    process.exit(1);
  }
  const want = JSON.parse(jsonTxt);
  const gk = Object.keys(got).sort(), wk = Object.keys(want).sort();
  const same = gk.length === wk.length && gk.every((k, i) => k === wk[i] && got[k] === want[k]);
  if(!same){
    console.warn(`rec-lint: recordings.enc.js is STALE (${gk.length} shipped vs ${wk.length} in recordings.json) — run node scripts/build-recordings.js + bump sw.js V.`);
    process.exit(1);
  }
  process.exit(0);
})();
