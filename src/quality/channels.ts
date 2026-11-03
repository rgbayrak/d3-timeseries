// Dictionary of physio.tsv column names. Quality metrics and waveforms are
// computed only for columns found in PHYSIO_CHANNELS; everything else
// (scanner triggers, stimulus markers, unknown columns) is excluded and
// reported. Relative imports only: this module is also loaded by Node scripts.

export type SignalType =
  | 'cardiac'
  | 'respiratory'
  | 'electrodermal'
  | 'gas'
  | 'blood_pressure'
  | 'muscle';

/**
 * Physiological column names (lower case, no separators; see channelKeys)
 * -> signal type. Covers the BIDS
 * recommended names (cardiac, respiratory) and common vendor/toolbox names
 * (e.g. PPG, ECG, RSP, EDA from physprep/NeuroKit).
 */
export const PHYSIO_CHANNELS: Record<string, SignalType> = {
  // cardiac
  cardiac: 'cardiac',
  ppg: 'cardiac',
  pleth: 'cardiac',
  plethysmograph: 'cardiac',
  pulse: 'cardiac',
  puls: 'cardiac',
  pulseox: 'cardiac',
  pulseoximeter: 'cardiac',
  bvp: 'cardiac',
  ecg: 'cardiac',
  ekg: 'cardiac',
  // respiratory
  respiratory: 'respiratory',
  respiration: 'respiratory',
  resp: 'respiratory',
  rsp: 'respiratory',
  breathing: 'respiratory',
  breath: 'respiratory',
  respbelt: 'respiratory',
  belt: 'respiratory',
  // electrodermal
  eda: 'electrodermal',
  edatonic: 'electrodermal',
  edaphasic: 'electrodermal',
  gsr: 'electrodermal',
  scr: 'electrodermal',
  scl: 'electrodermal',
  skinconductance: 'electrodermal',
  // exhaled gas
  co2: 'gas',
  o2: 'gas',
  etco2: 'gas',
  capnography: 'gas',
  // blood pressure
  bp: 'blood_pressure',
  abp: 'blood_pressure',
  bloodpressure: 'blood_pressure',
  // muscle
  emg: 'muscle',
};

/** Known non-physiological columns, excluded with a specific reason */
export const NON_PHYSIO_CHANNELS: Record<string, string> = {
  trigger: 'scanner trigger',
  trig: 'scanner trigger',
  ttl: 'scanner trigger',
  scanner: 'scanner trigger',
  scannertrigger: 'scanner trigger',
  volume: 'scanner trigger',
  slice: 'scanner trigger',
  mark: 'scanner/event marker',
  marker: 'scanner/event marker',
  event: 'scanner/event marker',
  stim: 'stimulus channel',
  stimulus: 'stimulus channel',
  digital: 'digital input',
  sync: 'sync signal',
  time: 'time stamp',
  timestamp: 'time stamp',
};

/**
 * Dictionary keys to try for a column name, most specific first: lower case
 * without separators (_ - space .), then also without trailing digits.
 * "ECG_2" -> ["ecg2", "ecg"], "CO2" -> ["co2", "co"].
 */
export function channelKeys(name: string): string[] {
  const full = name.toLowerCase().replace(/[\s_.-]+/g, '');
  const base = full.replace(/\d+$/, '');
  return base && base !== full ? [full, base] : [full];
}

export type ChannelClass =
  | { physio: true; signal: SignalType }
  | { physio: false; reason: string };

/** Own-key lookup, so names like "constructor" never hit Object.prototype */
const has = (dict: object, key: string) => Object.prototype.hasOwnProperty.call(dict, key);

export function classifyChannel(name: string): ChannelClass {
  const keys = channelKeys(name);
  for (const key of keys) {
    if (has(PHYSIO_CHANNELS, key)) return { physio: true, signal: PHYSIO_CHANNELS[key] };
  }
  for (const key of keys) {
    if (has(NON_PHYSIO_CHANNELS, key)) return { physio: false, reason: NON_PHYSIO_CHANNELS[key] };
  }
  return { physio: false, reason: 'not in the physio channel dictionary' };
}

export function isPhysioChannel(name: string): boolean {
  return classifyChannel(name).physio;
}
