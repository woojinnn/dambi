# Build from the repository root:
#   docker build -f adapter-registry/Dockerfile -t scopeball-adapter-registry .
#
# Or via docker-compose:
#   docker compose --profile adapter-registry up -d --build adapter-registry
#
# The image is tiny (nginx:alpine + a few hundred bytes of config + manifest).
# Phase 3 will deploy the contents of `public/` to S3 + CloudFront; until then
# this container behaves identically from the client's view.

FROM nginx:alpine

# Replace the default config with ours. Using the top-level nginx.conf rather
# than conf.d/default.conf because we need to control gzip / log_format /
# worker_processes from the http {} block.
COPY adapter-registry/nginx.conf /etc/nginx/nginx.conf

# Static asset root. `public/` already contains an empty `manifest.json`
# and an `adapters/.gitkeep`, so a freshly built image is healthy out of the box.
COPY adapter-registry/public/ /usr/share/nginx/html/

EXPOSE 80

# Healthcheck — passes as soon as the manifest is reachable.
HEALTHCHECK --interval=30s --timeout=3s --start-period=2s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/manifest.json || exit 1

# nginx:alpine already sets `CMD ["nginx", "-g", "daemon off;"]`; we inherit it.
