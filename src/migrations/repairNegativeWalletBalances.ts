import { WalletModel } from '../models/wallet.model'

/**
 * Legacy payment code could debit a wallet before checking its balance.
 * Wallet balances are prepaid funds, so negative values are invalid and must
 * never be carried forward as debt against a future top-up.
 */
export const repairNegativeWalletBalances = async () => {
  await Promise.all([
    WalletModel.updateMany({ NGNBalance: { $lt: 0 } }, { $set: { NGNBalance: 0 } }),
    WalletModel.updateMany({ USDBalance: { $lt: 0 } }, { $set: { USDBalance: 0 } }),
    WalletModel.updateMany({ GMDBalance: { $lt: 0 } }, { $set: { GMDBalance: 0 } }),
  ])
}
