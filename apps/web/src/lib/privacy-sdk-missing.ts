/**
 * Stand-in for every `privacy-sdk/*` module when the app was built without
 * STARKNET_PRIVACY (vite.config.ts). The loader detects it by the marker and
 * throws the one message that says what to do; demo and direct modes never
 * touch it.
 */
export const __privacySdkMissing = true;
export const MISSING_MESSAGE =
  "Pool mode needs the Privacy SDK, which is not on npm. Build a starknet-privacy checkout " +
  "(cd <checkout>/sdk && npm ci && npm run build) and start the app with " +
  "STARKNET_PRIVACY=<checkout> — see apps/web/README.md.";
