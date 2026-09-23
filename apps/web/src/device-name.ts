const ADJECTIVES = [
  "Amber",
  "Bright",
  "Calm",
  "Cloudy",
  "Gentle",
  "Golden",
  "Misty",
  "Quiet",
  "Silver",
  "Soft",
  "Still",
  "Sunny",
  "Swift",
  "Warm",
  "Winter",
  "Young",
] as const;

const NOUNS = [
  "Birch",
  "Brook",
  "Cedar",
  "Finch",
  "Fox",
  "Heron",
  "Lake",
  "Otter",
  "Pine",
  "River",
  "Robin",
  "Stone",
  "Willow",
  "Wolf",
  "Wren",
  "Yew",
] as const;

export function generateDeviceDisplayName(): string {
  const values = crypto.getRandomValues(new Uint32Array(2));
  const adjective = ADJECTIVES[(values[0] ?? 0) % ADJECTIVES.length];
  const noun = NOUNS[(values[1] ?? 0) % NOUNS.length];
  return `${adjective} ${noun}`;
}
