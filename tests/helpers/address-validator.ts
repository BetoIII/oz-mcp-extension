// tests/helpers/address-validator.ts
// Helper to validate and mock addresses

export interface AddressData {
  address: string;
  inOZ: boolean;
  tractId?: string;
  county?: string;
  state?: string;
}

export const KNOWN_OZ_ADDRESSES: AddressData[] = [
  {
    address: '123 Main St, Miami, FL 33125',
    inOZ: true,
    tractId: '12086004902',
    county: 'Miami-Dade',
    state: 'FL'
  },
  {
    address: '789 Flagler St, Miami, FL 33130',
    inOZ: true,
    tractId: '12086003700',
    county: 'Miami-Dade',
    state: 'FL'
  },
  {
    address: '111 NW 1st St, Miami, FL 33128',
    inOZ: true,
    tractId: '12086004801',
    county: 'Miami-Dade',
    state: 'FL'
  },
  {
    address: '100 Biscayne Blvd, Miami, FL 33132',
    inOZ: true,
    tractId: '12086003000',
    county: 'Miami-Dade',
    state: 'FL'
  },
  {
    address: '50 Biscayne Blvd, Miami, FL 33132',
    inOZ: true,
    tractId: '12086003000',
    county: 'Miami-Dade',
    state: 'FL'
  },
  {
    address: '200 S Biscayne Blvd, Miami, FL 33131',
    inOZ: true,
    tractId: '12086003000',
    county: 'Miami-Dade',
    state: 'FL'
  }
];

export const NON_OZ_ADDRESSES: AddressData[] = [
  {
    address: '456 Ocean Dr, Miami Beach, FL 33139',
    inOZ: false
  },
  {
    address: '321 Collins Ave, Miami Beach, FL 33140',
    inOZ: false
  },
  {
    address: '999 Brickell Ave, Miami, FL 33131',
    inOZ: false
  },
  {
    address: '2000 Ponce De Leon Blvd, Coral Gables, FL 33134',
    inOZ: false
  },
  {
    address: '4000 Salzedo St, Coral Gables, FL 33146',
    inOZ: false
  },
  {
    address: '8950 SW 74th Ct, Miami, FL 33156',
    inOZ: false
  }
];

export function validateAddressFormat(address: string): boolean {
  // Basic address validation
  const addressPattern = /^\d+\s+[\w\s]+,\s+[\w\s]+,\s+[A-Z]{2}\s+\d{5}(-\d{4})?$/;
  return addressPattern.test(address.trim());
}

export function normalizeAddress(address: string): string {
  return address
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,\s*/g, ', ')
    .toUpperCase();
}