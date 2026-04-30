const entries = [];

export function log(category, message) {
  const t = new Date().toTimeString().slice(0, 8);
  entries.unshift({ t, category, message });
  if (entries.length > 300) entries.pop();
}

export function getEntries() { return entries; }
