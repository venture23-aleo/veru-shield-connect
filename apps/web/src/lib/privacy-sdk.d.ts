// The Privacy SDK is resolved by path at build time (vite.config.ts); it has
// no package entry TypeScript can see from here. Shapes are pinned in
// privacySdk.ts, where every call site is wrapped.
declare module "privacy-sdk";
declare module "privacy-sdk/hashes";
declare module "privacy-sdk/abi";
declare module "privacy-sdk/contract-discovery";
declare module "privacy-sdk/mock-proving";
