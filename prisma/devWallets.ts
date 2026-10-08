/**
 * Deterministic Hardhat Network development wallets.
 * Addresses only. Private keys stay in backend environment files.
 *
 * Hardhat account #1 → investigator1
 * Hardhat account #2 → investigator2
 */
export const DEV_INVESTIGATOR_WALLETS = {
  "investigator1@blocktrace.local": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "investigator2@blocktrace.local": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
} as const;
