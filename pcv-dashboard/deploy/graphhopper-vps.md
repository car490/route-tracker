# GraphHopper VPS — deployed (2026-06-28)

Live at `https://routing.pcvtechnologies.co.uk`, wired into Vercel's
`GRAPHHOPPER_URL` for both Production and the `develop` Preview.

Moved from `routing.coachmate.uk` on 2026-10-02. When `coachmate.uk`'s nameservers
moved from 123-reg to Cloudflare, the `routing` record wasn't recreated, so production
failed with `getaddrinfo ENOTFOUND routing.coachmate.uk`. Caddy then couldn't renew its
certificate either: it expired 2026-09-26. The server itself was healthy throughout.
Caddy still answers to the old name too, but nothing should point at it.

## Server
- Hetzner Cloud `cpx22` (2 vCPU / 4GB RAM / 80GB disk), Falkenstein (`fsn1`) — €23.39/mo
- Host: `91.99.145.14`, SSH as `deploy` with `~/.ssh/hetzner_routetracker`
- `hcloud` CLI context: `routetracker` (auth via `HCLOUD_TOKEN` env var)
- ufw + Hetzner Cloud Firewall both restricted to 22/80/443
- 6GB swapfile at `/swapfile` (needed for the OSM extract step, not for serving)

## Map data
Lincolnshire/Peterborough regional extract, not full England — keeps the
4GB box viable. Bounding box `-0.75,52.4,0.55,53.75` covers all current
routes (Boston, Kirton, Spalding, Peterborough, etc.) with margin.

To rebuild the extract (e.g. routes expand outside the bbox):
```bash
ssh -i ~/.ssh/hetzner_routetracker deploy@91.99.145.14
cd ~/graphhopper
curl -fSL -o england-latest.osm.pbf https://download.geofabrik.de/europe/united-kingdom/england-latest.osm.pbf
osmium extract -b <minlon,minlat,maxlon,maxlat> england-latest.osm.pbf -o lincolnshire-peterborough.osm.pbf --overwrite
rm england-latest.osm.pbf
sudo systemctl restart graphhopper   # rebuilds the graph from the new pbf
```
Note: Geofabrik moved their GB hierarchy from `europe/great-britain/...` to
`europe/united-kingdom/...` at some point — the old path 302-redirects to
their homepage instead of erroring, so a stale URL silently "succeeds" with
an HTML page instead of the pbf. Verify with `curl -sI` first.

`osmium extract` needs RAM for a node-location index across the *whole*
input file (not just the bbox) — OOMs on a 4GB box without the swapfile.

## GraphHopper service
- `graphhopper-web-11.0.jar`, `pcv` profile (Landmarks, not CH), config/jar
  copied from the repo's local `graphhopper/` folder (not re-downloaded)
- Runs as systemd unit `graphhopper.service`, `-Xmx2g`, `Restart=on-failure`,
  enabled on boot
- Bound to `127.0.0.1:8989` only — never exposed directly

## TLS
Caddy (`/etc/caddy/Caddyfile`) reverse-proxies `routing.pcvtechnologies.co.uk`
(and the old `routing.coachmate.uk`) → `127.0.0.1:8989`, auto-HTTPS via Let's Encrypt.
DNS is an A record in Cloudflare's `pcvtechnologies.co.uk` zone (`routing` →
`91.99.145.14`), **DNS only (grey cloud)**. Proxying it through Cloudflare would get in
the way of Caddy getting its own certificate. If the name stops resolving, the
certificate silently stops renewing too. Check both with `curl https://routing.pcvtechnologies.co.uk/health`.

## Vercel
```bash
vercel env add GRAPHHOPPER_URL preview develop --value "https://routing.pcvtechnologies.co.uk" --yes
vercel env add GRAPHHOPPER_PROFILE preview develop --value "pcv" --yes
```
`vercel env add KEY preview` alone prompts for a branch in a way `--yes`
doesn't resolve — pass the branch explicitly. Env var changes don't apply to
already-built deployments; redeploy with `vercel redeploy <url>` to pick them up.

## Open decision
Whether the extract bbox needs widening if routes expand beyond
Lincolnshire/Peterborough.
