// Membandingkan kelengkapan dua kamus terjemahan di client/src/lib/i18n.jsx.
//
// Kunci yang ada di satu bahasa tapi tidak di bahasa lain tidak membuat build
// gagal dan tidak kelihatan di layar — t() diam-diam jatuh ke teks Indonesia.
// Akibatnya UI berbahasa Inggris menampilkan kalimat Indonesia di tempat yang
// jarang dibuka, dan tidak ada yang menyadarinya sampai ada yang melapor.
// Pemeriksaan ini dulu dilakukan manual; sekarang CI yang mengerjakannya.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "client/src/lib/i18n.jsx");
const source = fs.readFileSync(file, "utf8");

// Kamus ditulis sebagai object literal biasa, jadi cukup dipotong dengan
// mencocokkan kurung kurawal — tanpa perlu parser JSX.
function extractDictionary(name) {
  const marker = `const ${name} = {`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Kamus "${name}" tidak ditemukan di ${file}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      return new Function(`return (${source.slice(open, i + 1)})`)();
    }
  }
  throw new Error(`Kurung kurawal kamus "${name}" tidak tertutup`);
}

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  );

const dictionaries = { id: flatten(extractDictionary("id")), en: flatten(extractDictionary("en")) };
const missing = (a, b) => dictionaries[a].filter((key) => !dictionaries[b].includes(key));

const onlyId = missing("id", "en");
const onlyEn = missing("en", "id");

console.log(`id: ${dictionaries.id.length} kunci · en: ${dictionaries.en.length} kunci`);

if (onlyId.length === 0 && onlyEn.length === 0) {
  console.log("Kedua kamus sejajar.");
  process.exit(0);
}

if (onlyId.length) console.error(`\nBelum diterjemahkan ke Inggris (${onlyId.length}):\n  ${onlyId.join("\n  ")}`);
if (onlyEn.length) console.error(`\nTidak ada padanannya di Indonesia (${onlyEn.length}):\n  ${onlyEn.join("\n  ")}`);
process.exit(1);
