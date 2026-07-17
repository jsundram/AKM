#!/usr/bin/env node
// Encrypt recordings.json → recordings.enc.js. Plaintext links (the gitignored recordings.json)
// never ship; only the ciphertext blob does, so a non-participant at the public URL gets an
// undecryptable payload. AES-GCM with a key stretched from the shared participant password via
// PBKDF2-SHA256. concerts.html decrypts client-side once the password is entered (WebCrypto —
// same primitives both ends). Re-run whenever links or the password change, then bump sw.js V.
//
//   node scripts/build-recordings.js
//
// The password is resolved in priority order, so a re-run needs no ceremony:
//   1. REC_PW in the environment       (REC_PW='…' node scripts/build-recordings.js)
//   2. REC_PW=… in a local .env file   (gitignored — the low-friction default for repeat builds)
//   3. an interactive hidden prompt     (typed twice to confirm, when neither of the above is set)
// It never touches argv, so it stays out of shell history. In a non-interactive shell (CI) with no
// env/.env, it errors rather than hanging on a prompt.
const fs = require("fs");
const path = require("path");
const { webcrypto: wc } = require("crypto");

const root = path.join(__dirname, "..");
const iter = 200000;
const b64 = u => Buffer.from(u).toString("base64");

function fromDotenv(){                                            // minimal REC_PW reader — no dependency
  const f = path.join(root, ".env");
  if(!fs.existsSync(f)) return null;
  const m = fs.readFileSync(f, "utf8").match(/^\s*REC_PW\s*=\s*(.*)$/m);
  if(!m) return null;
  let v = m[1].trim();
  if(v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
  return v || null;
}

function promptHidden(q){                                        // raw-mode read, no echo of the password
  return new Promise(resolve => {
    const stdin = process.stdin;
    process.stdout.write(q);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let buf = "";
    const done = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData);
      process.stdout.write("\n"); resolve(buf); };
    const onData = chunk => {
      for(const ch of chunk){
        if(ch === "\r" || ch === "\n" || ch === "\u0004"){ done(); return; }
        if(ch === "\u0003"){ process.stdout.write("\n"); process.exit(1); }   // ctrl-c
        if(ch === "\u007f" || ch === "\b"){ buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

// Coverage report: every concert piece keys a recording as "<id> | <composer> | <title>" (the same
// recKey concerts.html builds). List the concert pieces with no entry (a newly-added concert can't
// then silently ship linkless — the reason this exists), and any recording key matching no piece (a
// typo, or a piece dropped from the program). Warn-only: some pieces legitimately have no recording.
function coverage(map){
  let Concerts;
  try { require("./../concert-data.js"); Concerts = globalThis.Concerts; } catch {}
  if(!Concerts || !Concerts.all){ console.warn("coverage: concert-data.js not loadable — skipping report"); return; }
  const keyOf = (c, p) => `${c.id} | ${p.c} | ${p.t}`;
  const pieceKeys = new Set();
  const missing = [];
  for(const c of Concerts.all) for(const p of (c.pieces || [])){
    if(p.brk) continue;
    const k = keyOf(c, p);
    pieceKeys.add(k);
    if(!(k in map)) missing.push(k);
  }
  const orphans = Object.keys(map).filter(k => !pieceKeys.has(k));
  const covered = pieceKeys.size - missing.length;
  console.log(`coverage: ${covered}/${pieceKeys.size} concert pieces have a recording`);
  if(missing.length){ console.warn(`  ${missing.length} piece(s) with NO recording:`); missing.forEach(k => console.warn(`    - ${k}`)); }
  if(orphans.length){ console.warn(`  ${orphans.length} recording key(s) matching NO concert piece (typo/dropped?):`); orphans.forEach(k => console.warn(`    ~ ${k}`)); }
}

async function resolvePw(){
  if(process.env.REC_PW) return process.env.REC_PW;
  const dot = fromDotenv();
  if(dot){ console.log("password: read from .env"); return dot; }
  if(process.stdin.isTTY){
    const a = await promptHidden("Recordings password: ");
    const b = await promptHidden("Confirm password:    ");
    if(!a){ console.error("empty password — aborting"); process.exit(1); }
    if(a !== b){ console.error("passwords don't match — aborting"); process.exit(1); }
    return a;
  }
  console.error("no password: set REC_PW, add REC_PW=… to a local .env, or run interactively.");
  process.exit(1);
}

(async () => {
  const pw = await resolvePw();
  const map = JSON.parse(fs.readFileSync(path.join(root, "recordings.json"), "utf8"));
  const data = new TextEncoder().encode(JSON.stringify(map));    // compact — no source formatting leaks
  const salt = wc.getRandomValues(new Uint8Array(16));
  const iv = wc.getRandomValues(new Uint8Array(12));
  const km = await wc.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  const key = await wc.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ct = new Uint8Array(await wc.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  const out =
    "// GENERATED by scripts/build-recordings.js — do not edit by hand.\n" +
    "// Encrypted concert-recording links (AES-GCM, key = PBKDF2-SHA256 of the shared password).\n" +
    "// Plaintext lives in the gitignored recordings.json; only this ciphertext ships. concerts.html\n" +
    "// decrypts it in the browser once a participant enters the password. Re-generate + bump sw.js V.\n" +
    `window.RecEnc = {v:1,iter:${iter},salt:"${b64(salt)}",iv:"${b64(iv)}",ct:"${b64(ct)}"};\n`;
  fs.writeFileSync(path.join(root, "recordings.enc.js"), out);
  console.log(`recordings.enc.js written — ${Object.keys(map).length} links, ${ct.length} bytes ciphertext`);
  coverage(map);
})();
