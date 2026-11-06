declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TAILSCALE_SERVE_ORIGIN?: string;
    /** HMAC secret for the IM webhook (app/api/im); without it the webhook answers 503. */
    IM_WEBHOOK_SECRET?: string;
    /** Link sent in IM when a business needs page authentication. */
    IM_APP_URL?: string;
  }
}
