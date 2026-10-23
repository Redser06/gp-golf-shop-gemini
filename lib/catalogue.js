/**
 * The Augusta Collection & Fairway Club Catalogue.
 *
 * All primary 3-ball sleeves are priced at 3 for $16.00 ($16.00 / 1600 cents).
 */

export const CATALOGUE = [
  {
    id: 'tour-velocity-3',
    name: 'Tour Velocity',
    badge: 'Distance',
    qty: 3,
    priceCents: 1600,
    priceDisplay: '$16.00',
    tagline: 'High-energy core for maximum distance and penetrating ball flight.',
    specs: {
      cover: 'Cast Urethane',
      compression: 95,
      feel: 'Firm & Fast',
      dimples: 338,
      recommended: 'Swing speed > 95 mph',
    },
    traits: ['Max Distance', 'Low Driver Spin', 'Penetrating Flight'],
  },
  {
    id: 'royal-classic-3',
    name: 'Royal Classic',
    badge: 'Balanced',
    qty: 3,
    priceCents: 1600,
    priceDisplay: '$16.00',
    tagline: 'The timeless all-rounder. Uncompromising straightness and high forgiveness.',
    specs: {
      cover: 'Surlyn Hybrid',
      compression: 80,
      feel: 'Medium Soft',
      dimples: 342,
      recommended: 'All handicap levels',
    },
    traits: ['Balanced Spin', 'Forgiving Flight', 'Durable Cover'],
  },
  {
    id: 'pure-soft-3',
    name: 'Pure Soft',
    badge: 'Feel & Control',
    qty: 3,
    priceCents: 1600,
    priceDisplay: '$16.00',
    tagline: 'Ultra-low compression with responsive greenside spin for delicate wedge work.',
    specs: {
      cover: 'Thin Urethane',
      compression: 65,
      feel: 'Ultra Soft',
      dimples: 328,
      recommended: 'Smooth swings & touch players',
    },
    traits: ['Greenside Control', 'High Wedge Spin', 'Quiet Off Putter'],
  },
  {
    id: 'royal-classic-2',
    name: 'Royal Classic (2-Pack)',
    badge: 'Top-Up',
    qty: 2,
    priceCents: 1100,
    priceDisplay: '$11.00',
    tagline: 'A quick pair for the back nine.',
    specs: { cover: 'Surlyn Hybrid', compression: 80, feel: 'Medium Soft', dimples: 342 },
    traits: ['Top-Up', '2 Balls'],
  },
  {
    id: 'pure-soft-1',
    name: 'Pure Soft (Single)',
    badge: 'Sample',
    qty: 1,
    priceCents: 550,
    priceDisplay: '$5.50',
    tagline: 'Test the feel on the practice green.',
    specs: { cover: 'Thin Urethane', compression: 65, feel: 'Ultra Soft', dimples: 328 },
    traits: ['Single Ball', 'Trial'],
  },
];

export function findItem(id) {
  return CATALOGUE.find((item) => item.id === id);
}

export function cartTotals(cart) {
  let total = 0;
  let count = 0;
  for (const line of cart) {
    const item = findItem(line.id);
    if (!item) continue;
    const qty = Math.max(1, Number(line.qty) || 1);
    total += item.priceCents * qty;
    count += item.qty * qty;
  }
  return {
    total,
    count,
    label: formatAmount(total),
  };
}

export function cartSummary(cart) {
  if (!cart.length) return 'Empty bag';
  return cart
    .map((line) => {
      const item = findItem(line.id);
      if (!item) return '';
      return `${line.qty > 1 ? `${line.qty} × ` : ''}${item.name} (${item.qty} balls)`;
    })
    .filter(Boolean)
    .join(', ');
}

export function formatAmount(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format((Number(cents) || 0) / 100);
}
