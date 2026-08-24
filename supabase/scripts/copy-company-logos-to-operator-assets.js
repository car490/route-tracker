// One-off: copy every object in the legacy `company-logos` Storage bucket
// into `operator-assets` under the same `{company_id}/logo.*` path.
//
// Fixes the bucket-mismatch bug (docs/branding-consolidation-plan.md step 1):
// BrandingPage.jsx always wrote to operator-assets, but Layout.jsx/
// CompanyModal.jsx wrote to company-logos — same companies.logo_path column,
// two buckets, so a logo uploaded via one path 404'd when read via the
// other. Now that all three read/write operator-assets, any logo that only
// ever existed in company-logos needs copying across first or it goes
// missing for that operator. Run this BEFORE deploying the BUCKET fix.
//
// Both buckets are public (supabase/schema.sql), so this reads objects over
// their public URL and re-uploads them — no need for the storage copy API
// to support cross-bucket copies.
//
// Usage:
//   node copy-company-logos-to-operator-assets.js          -> dry run, lists what would copy
//   node copy-company-logos-to-operator-assets.js --apply  -> actually copies
//
// Env required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY   (needed for --apply; dry run works with anon key too)

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const APPLY = process.argv.includes('--apply');

if (!SUPABASE_URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY for dry run).');
  process.exit(1);
}

async function storageApi(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  }
  return res;
}

async function listBucket(bucket, prefix) {
  const res = await storageApi(`/object/list/${bucket}`, {
    method: 'POST',
    body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  });
  return res.json();
}

// `company-logos` objects live at `{company_id}/logo.{ext}` — one level of
// folders, each containing one file. List the root for folders, then each
// folder for its file.
async function listAllObjects(bucket) {
  const entries = [];
  const roots = await listBucket(bucket, '');
  for (const item of roots) {
    if (item.id === null) {
      // folder
      const files = await listBucket(bucket, `${item.name}/`);
      for (const file of files) {
        if (file.id !== null) entries.push(`${item.name}/${file.name}`);
      }
    } else {
      entries.push(item.name);
    }
  }
  return entries;
}

async function objectExists(bucket, key) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${bucket}/${key}`, { method: 'HEAD' });
  return res.ok;
}

async function main() {
  console.log('Listing objects in company-logos...');
  const sourceKeys = await listAllObjects('company-logos');
  console.log(`${sourceKeys.length} object(s) found in company-logos.\n`);

  const toCopy = [];
  for (const key of sourceKeys) {
    const alreadyThere = await objectExists('operator-assets', key);
    toCopy.push({ key, alreadyThere });
  }

  for (const { key, alreadyThere } of toCopy) {
    console.log(alreadyThere ? `SKIP  (already in operator-assets): ${key}` : `COPY  ${key}`);
  }

  const pending = toCopy.filter(t => !t.alreadyThere);
  console.log(`\n${pending.length}/${sourceKeys.length} to copy.\n`);

  if (!APPLY) {
    console.log('Dry run only — no changes written. Re-run with --apply to copy.');
    return;
  }

  for (const { key } of pending) {
    const downloadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/public/company-logos/${key}`);
    if (!downloadRes.ok) {
      console.error(`  FAILED to download ${key}: ${downloadRes.status}`);
      continue;
    }
    const contentType = downloadRes.headers.get('content-type') || 'application/octet-stream';
    const body = await downloadRes.arrayBuffer();

    await storageApi(`/object/operator-assets/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
      body: Buffer.from(body),
    });
    console.log(`  Copied ${key}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
