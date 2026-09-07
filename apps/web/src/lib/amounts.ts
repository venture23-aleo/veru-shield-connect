/**
 * Token amounts at the UI boundary. The pool moves u128 smallest units; people
 * type "2.5". STRK is the one token we know the decimals of everywhere it
 * exists (Sepolia, mainnet, devnet: same address, 18 decimals); anything
 * else is shown and entered in smallest units, labelled as such.
 */
export const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const STRK_DECIMALS = 18;

export function isStrk(token: string): boolean {
  try {
    return BigInt(token.trim()) === BigInt(STRK_TOKEN);
  } catch {
    return false;
  }
}

export function decimalsOf(token: string): number {
  return isStrk(token) ? STRK_DECIMALS : 0;
}

/** "2.5" with 18 decimals → 2500000000000000000n; null when it is not a number for this token. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (decimals === 0) return /^[0-9]+$/.test(t) && BigInt(t) > 0n ? BigInt(t) : null;
  const m = new RegExp(`^([0-9]+)(?:\\.([0-9]{1,${decimals}}))?$`).exec(t);
  if (!m) return null;
  const whole = BigInt(m[1]!);
  const frac = BigInt(((m[2] ?? "") + "0".repeat(decimals)).slice(0, decimals));
  const v = whole * 10n ** BigInt(decimals) + frac;
  return v > 0n && v < 1n << 128n ? v : null;
}

/** Smallest units → a human number: trailing zeros dropped, thousands grouped. */
export function formatAmount(amount: bigint | string, decimals: number): string {
  const v = BigInt(amount);
  if (decimals === 0) return group(v.toString());
  const base = 10n ** BigInt(decimals);
  const whole = group((v / base).toString());
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** "2.5 STRK" or "4412337 units of 0x4718…938d". */
export function describeAmount(amount: bigint | string, token: string): string {
  if (isStrk(token)) return `${formatAmount(amount, STRK_DECIMALS)} STRK`;
  return `${formatAmount(amount, 0)} units of ${token.slice(0, 6)}…${token.slice(-4)}`;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
