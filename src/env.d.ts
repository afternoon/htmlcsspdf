/**
 * Bindings not yet present in the generated worker types.
 *
 * THUMBNAILS is optional because R2 must be enabled on the account before the
 * bucket can be created. Everything touching it already handles absence —
 * thumbnail capture is best-effort by design — so the app runs without it and
 * gains previews the moment the binding exists. Once `wrangler types` includes
 * it, this file can go.
 *
 * The `cloudflare:workers` env import is typed as `Cloudflare.Env`, so that is
 * the declaration to augment. No imports or exports here: this file must stay a
 * script rather than become a module for the augmentation to apply.
 */
declare namespace Cloudflare {
  interface Env {
    THUMBNAILS?: R2Bucket;
  }
}
