#!/usr/bin/env node
// One-shot transform: annotate Tauri commands with #[specta::specta] and add
// specta::Type to serde payload structs. Idempotent.
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '../src-tauri/src/commands');

for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.rs')) continue;
  const p = path.join(dir, file);
  let c = fs.readFileSync(p, 'utf8');

  // 1. Insert #[specta::specta] under every #[tauri::command] lacking it.
  c = c.replace(
    /#\[tauri::command\]\s*\n(#\[specta::specta\]\s*\n)?/g,
    (match, hasSpecta) => (hasSpecta ? match : '#[tauri::command]\n#[specta::specta]\n')
  );

  // 2. Add specta::Type to derives that contain both Serialize and Deserialize
  //    but not yet Type. Handles multi-line derive bodies.
  c = c.replace(
    /#\[derive\(([\s\S]*?)\)\]/g,
    (match, inner) => {
      if (/\bSerialize\b/.test(inner) && /\bDeserialize\b/.test(inner) && !/\bType\b/.test(inner)) {
        return `#[derive(${inner.trim()}, specta::Type)]`;
      }
      return match;
    }
  );

  fs.writeFileSync(p, c);
  console.log('✔', file);
}
