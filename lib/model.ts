// Token Radar, model radar-2: peer-median implied values for pre-token protocols.
//
// One snapshot in, one ranked board out. The board is the whole eligible universe:
// every watchlist slug, plus every other pre-token protocol that passes the same
// product test the watchlist was built from. Nothing is hand-picked and no protocol
// name is ever special-cased: a single function scores every row.
//
// The multiple comes from the market, not from a constant. For each protocol that
// already trades, the peer ratio is market cap over TVL, winsorised at 3.0. A
// category's multiple is the median of its peers' ratios, shrunk toward the global
// median (the median of every peer ratio) with a prior weight of 5, so a thin
// category borrows strength from the whole market instead of trusting two or three
// points. Categories with fewer than three peers use the global median outright.
//
//   ratio_k        = min(mcap_usd / tvl_usd, 3.0)          for each traded peer
//   global         = median of all peer ratios
//   median_cat     = median of the category's peer ratios, or global when peers < 3
//   multiple_cat   = (n * median_cat + 5 * global) / (n + 5)
//   growth         = clamp(change_7d, -50, +100) per cent
//   growthMult     = 1 + (growth / 100) * 0.5
//   maturityMult   = 0.7 + min(age_days, 1095) / 1095 * 0.3  (age unknown: 365 days)
//   implied        = max(1, round(tvl_usd * multiple_cat * growthMult * maturityMult))
//
// A zero market cap carries no price signal (DefiLlama records 0, and once -1, for
// tokens whose cap it could not read), so peers are the traded protocols with a
// nonzero recorded cap. The farm plan is derived from the protocol's own record
// (category, chains, TVL, age), never from a list of names.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The radar-2 constants: the shape of the model, not its results. */
export interface ModelConstants {
  winsor_cap: number;
  shrinkage_k: number;
  min_peers: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  winsor_cap: 3.0,
  shrinkage_k: 5,
  min_peers: 3,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** The selection rule, in the words the dashboard shows. */
export const SELECTION_RULE =
  'Watchlist (40) plus every other pre-token protocol passing the watchlist product test: ' +
  'not CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking or Restaked BTC; ' +
  'name does not end in a version marker; name carries no whole word wrapped, staked or staking; ' +
  'name does not start with an exchange name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini); ' +
  'name does not match ^w[A-Z]. Early rows are ranked by implied value, not TVL.';

/** One category's multiple, for the dashboard's multiples table. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  peers: number;
}

/** The peer table the model is built from: one median per category, one global. */
export interface PeerTable {
  global_multiple: number;
  peer_count: number;
  by_category: Map<string, { multiple: number; peers: number; median: number }>;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included so the page only renders. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  category_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  multiples: CategoryMultiple[];
  selection_rule: string;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle value of a sorted list (the mean of the middle two when its length is even). */
export function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) throw new SnapshotError('median of no peer ratios');
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The peer table, built from the snapshot at runtime. A peer is a protocol with a
 * nonzero recorded market cap and positive TVL; its ratio is market cap over TVL,
 * winsorised at the cap. The global multiple is the median of every peer ratio.
 */
export function peerTable(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): PeerTable {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd === 0 || !Number.isFinite(p.mcap_usd)) continue;
    if (!(p.tvl_usd > 0)) continue;
    const ratio = Math.min(p.mcap_usd / p.tvl_usd, model.winsor_cap);
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  if (all.length === 0) throw new SnapshotError('snapshot carries no traded peer to build multiples from');
  all.sort((a, b) => a - b);
  const global = medianOf(all);
  const table: PeerTable = { global_multiple: global, peer_count: all.length, by_category: new Map() };
  for (const [category, ratios] of byCategory) {
    ratios.sort((a, b) => a - b);
    const n = ratios.length;
    const median = n >= model.min_peers ? medianOf(ratios) : global;
    const multiple = (n * median + model.shrinkage_k * global) / (n + model.shrinkage_k);
    table.by_category.set(category, { multiple, peers: n, median });
  }
  return table;
}

/** One category's multiple out of the peer table; the global when the category has no peers. */
export function multipleFor(category: string | null, table: PeerTable): { multiple: number; peers: number } {
  const entry = category === null ? undefined : table.by_category.get(category);
  if (entry === undefined) return { multiple: table.global_multiple, peers: 0 };
  return { multiple: entry.multiple, peers: entry.peers };
}

/** Every distinct category the snapshot names, with its multiple and peer count, by name. */
export function categoryMultiples(protocols: SnapshotProtocol[], table: PeerTable): CategoryMultiple[] {
  const names = new Set<string>();
  for (const p of protocols) if (p.category !== null) names.add(p.category);
  return [...names].sort().map((category) => {
    const { multiple, peers } = multipleFor(category, table);
    return { category, multiple, peers };
  });
}

/** The multipliers and the implied value one protocol gets under the peer table. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  table: PeerTable,
  model: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null; multiple: number; peers: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { multiple, peers } = multipleFor(protocol.category, table);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age, multiple, peers };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol name must not start with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Categories that are not a protocol waiting on its own token. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** A wrapped-ticker name such as wTAO: a lowercase w followed by an uppercase letter. */
const WRAPPED_TICKER = /^w[A-Z]/;

/**
 * The watchlist's product test, as one predicate: pre-token, not an exchange, bridge
 * or wrapped/staked product, not a versioned pool, not an exchange's own product,
 * not a wrapped ticker. The watchlist itself passes it; the early rows are the
 * other pre-token protocols that pass it too.
 */
export function passesProductTest(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  if (WRAPPED_TICKER.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n and strictly decreasing implied values. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, table: PeerTable = peerTable(snapshot.protocols, model)): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, without exception.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol that passes the product test,
  // ranked by implied value like everything else. No TVL floor, no cap: the whole
  // eligible universe is the board.
  const early = snapshot.protocols.filter((p) => !chosen.has(p.slug) && passesProductTest(p));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const s = impliedValue(p, snapshot.as_of, table, model);
    return { p, ...s };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  let previous: number | null = null;
  return scored.map((s, i) => {
    let implied = s.implied;
    // A rank must mean a strictly larger value: if a row ever rounds to the same
    // dollar as the row above it, step it down just below that row (never below
    // $1), so the board stays a ranking.
    if (previous !== null && implied >= previous) implied = Math.max(1, previous - 1);
    previous = implied;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: implied,
      model: {
        category_multiple: s.multiple,
        category_peers: s.peers,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Whether the protocol's first chain is Ethereum, where gas costs far more than elsewhere. */
function isEthereum(p: SnapshotProtocol): boolean {
  return chainOf(p).toLowerCase() === 'ethereum';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} as a lender and keep the supply position open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} on ${chain} and place one position on a market that settles after at least a week.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('index')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action, so week after week is not the same generic chore. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return 'supply a little more USDC, borrow a small amount against it, or repay part of a borrow';
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) {
    return 'add a little more liquidity, swap a small amount through the pool, or claim and restake the rewards';
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return 'adjust the hedge a little, top up the margin, or close and reopen one small position';
  }
  if (c.includes('rwa')) return 'mint a small extra amount of the yield asset or check the yield accrual on the holding';
  if (c.includes('prediction')) return 'place one small position on a fresh market that is still open';
  if (c.includes('stak') || c.includes('restak')) return 'stake a small extra amount or restake the staking rewards';
  if (c.includes('curator') || c.includes('allocator') || c.includes('index')) return 'deposit a little more into the vault or move a small amount between its vaults';
  return 'make one small deposit, swap, or vote in the protocol';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from
 * a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyActionFor(p);
  const eth = isEthereum(p);
  const setupGas = eth ? 'about $12 of gas on Ethereum' : 'about $2 of gas';
  const weeklyGas = eth ? 'about $5 of gas a week on Ethereum' : 'under $1 of gas a week';
  return [
    {
      text: 'Create a fresh wallet that holds only the funds you plan to farm with, and write its seed phrase on paper and store it offline, never in a screenshot or a chat.',
      cost: 'nothing to create the wallet',
      time: '10 minutes',
    },
    {
      text: `${action} Do the transaction from the fresh wallet, on the protocol's own site, and save the transaction hash.`,
      cost: `$${capital} of capital and ${setupGas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Once a week, do one qualifying action: ${weekly}. Keep each week's action small and on the same wallet.`,
      cost: weeklyGas,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, without withdrawing, so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw anything, open ${p.name}'s own points or rewards page from its official site and check what you earned; claim only from the link that page publishes, and never pay a fee or a person to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet address, the dates, the amounts and every transaction hash in a farm log, so you can repeat the position or unwind it without guessing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    category_peers: row.model.category_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const table = peerTable(snapshot.protocols, model);
  const board = buildBoard(snapshot, model, table);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: table.global_multiple,
    multiples: categoryMultiples(snapshot.protocols, table),
    selection_rule: SELECTION_RULE,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, strict order, unique values, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} does not rank strictly below row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length !== 6) return `${r.slug} has ${steps.length} farm steps, not 6`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
