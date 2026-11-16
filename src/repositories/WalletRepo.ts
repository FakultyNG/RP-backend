import { WalletModel, WalletSchema } from '../models/wallet.model'
import { StringOrObjectId } from '../types'
import { getWalletCurrencyKey, ValidCurrency } from '../utils/currency'
import { MaybeSession } from '../utils/mongoDbSessionRunner'
import { OperationalError } from '../utils/OperationalError'

export type WalletCurrencyKey = keyof Pick<WalletSchema, 'NGNBalance' | 'USDBalance' | 'GMDBalance'>

interface UpdateBalanceInput {
  userId: StringOrObjectId
  topUpAmount: number
  currency: ValidCurrency
  session: MaybeSession
}

interface DebitBalanceInput {
  userId: StringOrObjectId
  amount: number
  currency: ValidCurrency
  session: MaybeSession
}

export class WalletRepo {
  static updateBalance = ({ userId, topUpAmount, currency, session }: UpdateBalanceInput) => {
    if (!Number.isFinite(topUpAmount) || topUpAmount < 0) {
      throw new OperationalError('wallet credit amount must not be negative', 400)
    }

    return WalletModel.findOneAndUpdate(
      { userId },
      {
        $inc: { [getWalletCurrencyKey(currency)]: topUpAmount },
      },
      { upsert: true, session, new: true, runValidators: true },
    )
  }

  static debitBalance = ({ userId, amount, currency, session }: DebitBalanceInput) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new OperationalError('wallet debit amount must be greater than zero', 400)
    }

    const balanceKey = getWalletCurrencyKey(currency)
    return WalletModel.findOneAndUpdate(
      { userId, [balanceKey]: { $gte: amount } },
      { $inc: { [balanceKey]: amount * -1 } },
      { session, new: true, runValidators: true },
    )
  }

  static totalBalance = () =>
    WalletModel.aggregate([
      {
        $match: {
          $expr: {
            $ne: ['$user_id', null],
          },
        },
      },
      {
        $group: {
          _id: null,
          total_balance: { $sum: '$balance' },
        },
      },
      {
        $project: {
          _id: 0,
          total_balance: 1,
        },
      },
    ])
}
