# GraphHopper VPS Stub

This file is a deployment stub for moving routing from local GraphHopper to a VPS-hosted service.

## 1) VPS prerequisites
- Ubuntu 22.04+ or Debian 12+
- 4+ vCPU, 8+ GB RAM minimum (depends on map size)
- 60+ GB disk for OSM + graph cache
- Public DNS name, e.g. graphhopper.example.com

## 2) Runtime layout (recommended)
- Reverse proxy with TLS (Caddy or Nginx)
- GraphHopper service bound to localhost:8989
- UFW/firewall allows only 80/443 inbound

## 3) GraphHopper process
Use your existing config shape from graphhopper/config.yml:
- profile: pcv
- encoded values for height/width/length
- datareader.file and graph.location paths on VPS

## 4) Health checks
- Basic: GET /route should return HTTP 400 or 405 (service reachable)
- Functional: POST /route with 2 points + profile=pcv should return HTTP 200

## 5) Dashboard integration
Set in Vercel project env:
- GRAPHHOPPER_URL=https://graphhopper.example.com
- GRAPHHOPPER_PROFILE=pcv

Then redeploy and verify:
- /api/directions-diagnostics -> urlConfigured=true
- /api/directions-diagnostics -> health.ok=true

## 6) Security notes
- Do not expose GraphHopper admin connector publicly
- Apply request size/rate limits at reverse proxy
- Restrict allowed methods to GET/POST
