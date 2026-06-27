/**
 * Transact wrapper — barrel export.
 */

export * from "./errors.js";
export * from "./types.js";
export { transact, isPositiveInteger } from "./wrapper.js";
export {
  transactDebitWallet,
  transactP2PTransfer,
  type DebitInput,
  type DebitResult,
  type TransferInput,
  type TransferResult,
} from "./wallet.js";
export {
  transactEscrowTransition,
  type EscrowState,
  type EscrowTransitionInput,
  type EscrowTransitionResult,
} from "./escrow.js";
export {
  transactBonusClaim,
  type BonusClaimInput,
  type BonusClaimResult,
} from "./bonus.js";
