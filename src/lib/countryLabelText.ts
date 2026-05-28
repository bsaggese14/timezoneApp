/** Short labels only when the full Natural Earth name cannot fit on the map. */
const MAP_LABEL_OVERRIDES: Record<string, string> = {
  "Bosnia and Herz.": "Bosnia",
  "Central African Rep.": "C.A.R.",
  "Dem. Rep. Congo": "D.R. Congo",
  "Dominican Rep.": "Dom. Rep.",
  "Falkland Is.": "Falkland",
  "Fr. S. Antarctic Lands": "Fr. Antar.",
  "Guinea-Bissau": "G.-Bissau",
  "New Caledonia": "N. Caledonia",
  "Papua New Guinea": "Papua N.G.",
  "Puerto Rico": "P.Rico",
  "Solomon Is.": "Sol.",
  "Timor-Leste": "Timor",
  "Trinidad and Tobago": "Trinidad",
  "United Arab Emirates": "UAE",
  "United Kingdom": "U.K.",
  "United States of America": "U.S.A.",
};

/** Used only when the full name cannot fit at any size or position. */
const LAST_RESORT_LABELS: Record<string, string> = {
  Luxembourg: "Lux.",
  Palestine: "Palest.",
};

const SKIP_WORDS = new Set([
  "and",
  "of",
  "the",
  "rep",
  "is",
  "dem",
  "fr",
  "s",
  "st",
]);

function acronymLabel(name: string): string | null {
  const parts = name
    .split(/[\s.'-]+/)
    .map((w) => w.replace(/[^A-Za-zÀ-ÿ]/g, ""))
    .filter((w) => w.length > 0 && !SKIP_WORDS.has(w.toLowerCase()));

  if (parts.length < 3) return null;

  const acronym = parts
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 4);

  return acronym.length >= 2 && acronym !== name ? acronym : null;
}

function compactLabel(name: string): string | null {
  const override = MAP_LABEL_OVERRIDES[name];
  if (override && override !== name) return override;

  if (name.endsWith(" Rep.")) {
    const shorter = name.slice(0, -5);
    return shorter !== name ? shorter : null;
  }

  if (name.endsWith(" Is.")) {
    const shorter = `${name.slice(0, -4)}s`;
    return shorter !== name ? shorter : null;
  }

  if (name.length <= 14) return null;

  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 2 && words[1]!.length <= 5) {
    return words[0]!;
  }

  return acronymLabel(name);
}

/**
 * Alternate label strings, longest first. Full name is always first;
 * shorter forms are only for fallback when the full name cannot fit.
 */
export function countryLabelCandidates(fullName: string): string[] {
  const out: string[] = [fullName];
  const seen = new Set<string>([fullName.toLowerCase()]);

  for (const label of [compactLabel(fullName), acronymLabel(fullName)]) {
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }

  const lastResort = LAST_RESORT_LABELS[fullName];
  if (lastResort) {
    const key = lastResort.toLowerCase();
    if (!seen.has(key)) out.push(lastResort);
  }

  return out;
}
