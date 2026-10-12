// Read-only mistl compatibility proof: compile the actual pure verifier functions in an isolated harness.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const mistl = resolve(root, '../mistl');
const output = resolve(root, 'node_modules/.tmp/w3-relay-proof');
await mkdir(resolve(output, 'src'), { recursive: true });
function fn(source, name) {
  const match = new RegExp('(?:pub(?:\\(crate\\))? )?fn ' + name + '\\(').exec(source);
  if (!match) throw new Error('Missing mistl function ' + name);
  const start = match.index, open = source.indexOf('{', start);
  let depth = 1, end = open + 1;
  for (; depth; end++) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; if (end >= source.length) throw new Error('Unbalanced function'); }
  return source.slice(start, end);
}
const signing = await readFile(resolve(mistl, 'src/wiresign.rs'), 'utf8');
const relay = await readFile(resolve(mistl, 'src/chat_relay/mod.rs'), 'utf8');
const identity = await readFile(resolve(mistl, 'src/identity/mod.rs'), 'utf8');
const fixture = await readFile(resolve(root, 'src/escrow/roomBinding.fixture.ts'), 'utf8');
const json = fixture.slice(fixture.indexOf('= ') + 2, fixture.lastIndexOf(' as const;'));
await writeFile(resolve(output, 'vectors.json'), json);
const rust = 'use base64::Engine as _; use base64::engine::general_purpose::URL_SAFE_NO_PAD; use serde_json::{Map, Value};\n' +
  'mod wiresign { use serde_json::{Map, Value, Number};\n' + ['stable_stringify', 'format_number', 'signing_payload'].map(n => fn(signing, n)).join('\n') + '\n}\n' +
  'mod identity { use anyhow::{Result, Context, anyhow, bail}; use ed25519_dalek::{Signature, Verifier, VerifyingKey}; const ED25519_DID_KEY_LEN: usize = 56; const MULTICODEC_ED25519_PUB: [u8;2] = [0xed,1];\n' +
  ['verify', 'pubkey_from_did'].map(n => fn(identity, n)).join('\n') + '\n}\n' + fn(relay, 'verify_wire') + '\n' +
  '#[test] fn room_bound_web_wires_verify_with_actual_mistl_functions() { let vectors: Value = serde_json::from_str(include_str!("../vectors.json")).unwrap(); for v in vectors.as_array().unwrap() { let wire=v["wire"].as_object().unwrap(); assert_eq!(wiresign::signing_payload(wire),v["payload"].as_str().unwrap()); assert!(verify_wire(wire)); let mut tampered=wire.clone(); tampered.insert("roomId".into(),Value::String("wrong".into())); assert!(!verify_wire(&tampered)); } }\n';
await writeFile(resolve(output, 'src/lib.rs'), rust);
await writeFile(resolve(output, 'Cargo.toml'), '[package]\nname="tc-chat-room-binding-proof"\nversion="0.0.0"\nedition="2024"\n[dependencies]\nanyhow="1"\nbase64="0.22"\nbs58="0.5"\nserde_json="1"\ned25519-dalek="2"\n');
let env = { ...process.env };
if (process.platform === 'win32') {
  const found = spawnSync('C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',
    ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true });
  const installation = found.stdout?.trim() || 'C:/Program Files (x86)/Microsoft Visual Studio/18/BuildTools';
  if (installation) {
    const setup = spawnSync('cmd.exe', ['/d', '/s', '/c', '""' + resolve(installation, 'VC/Auxiliary/Build/vcvars64.bat') + '" >nul && set"'], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true });
    if (setup.status !== 0) throw new Error('Visual Studio environment setup failed');
    for (const line of setup.stdout.split(/\r?\n/)) {
      const split = line.indexOf('='); if (split > 0) { const key = line.slice(0, split); env[key.toLowerCase() === 'path' ? 'Path' : key] = line.slice(split + 1); }
    }
    // Windows environment keys are case-insensitive, but Node deduplicates them lexically.
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path' && key !== 'Path') delete env[key];
  }
}
const result = spawnSync(process.env.CARGO_PATH || 'cargo', ['test', '--offline', '--manifest-path', resolve(output, 'Cargo.toml')], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
