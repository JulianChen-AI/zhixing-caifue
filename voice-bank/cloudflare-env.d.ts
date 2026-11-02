declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TAILSCALE_SERVE_ORIGIN?: string;
  }
}
