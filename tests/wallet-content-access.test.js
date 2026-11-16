const mockWalletFindOneAndUpdate = jest.fn()
const mockPaymentFindOne = jest.fn()

jest.mock('../build/src/env', () => ({
  __esModule: true,
  default: {
    PAYSTACK_SECRET_KEY: 'test',
    FLUTTERWAVE_SECRET_KEY: 'test',
    FLUTTERWAVE_PUBLIC_KEY: 'test',
    FLUTTERWAVE_ENCYPTION_KEY: 'test',
    WAVE_API_KEY: 'test',
    NGN_PREMIUM_CONTENT_COST: 400,
    USD_PREMIUM_CONTENT_COST: 10,
  },
}))

jest.mock('../build/src/models/wallet.model', () => ({
  WalletModel: { findOneAndUpdate: mockWalletFindOneAndUpdate },
}))

jest.mock('../build/src/models/payments.model', () => ({
  PaymentModel: { findOne: mockPaymentFindOne },
}))

const { WalletRepo } = require('../build/src/repositories/WalletRepo')
const { PaymentService } = require('../build/src/services/core/PaymentService')

describe('wallet content purchase protection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('debits only when the selected wallet balance covers the full amount', async () => {
    mockWalletFindOneAndUpdate.mockResolvedValue({ NGNBalance: 100 })

    await WalletRepo.debitBalance({
      userId: 'user-1',
      amount: 400,
      currency: 'NGN',
      session: undefined,
    })

    expect(mockWalletFindOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'user-1', NGNBalance: { $gte: 400 } },
      { $inc: { NGNBalance: -400 } },
      { session: undefined, new: true, runValidators: true },
    )
  })

  test('rejects zero or negative wallet debits before touching the database', () => {
    expect(() =>
      WalletRepo.debitBalance({
        userId: 'user-1',
        amount: -400,
        currency: 'NGN',
        session: undefined,
      }),
    ).toThrow('wallet debit amount must be greater than zero')

    expect(mockWalletFindOneAndUpdate).not.toHaveBeenCalled()
  })

  test('unlocks VOD only with a successful, used wallet content payment', async () => {
    mockPaymentFindOne.mockResolvedValue({ _id: 'payment-1' })

    await expect(
      PaymentService.checkHasValidContentPayment({
        currentUserId: 'user-1',
        contentId: 'video-1',
        contentType: 'vod',
      }),
    ).resolves.toEqual({ canView: true })

    expect(mockPaymentFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        videoId: 'video-1',
        status: 'success',
        isUsed: true,
        method: 'wallet',
        useCase: { $in: ['video-watch-premium', 'video-watch-exclusive'] },
      }),
    )
  })

  test('keeps content locked when no qualifying wallet payment exists', async () => {
    mockPaymentFindOne.mockResolvedValue(null)

    await expect(
      PaymentService.checkHasValidContentPayment({
        currentUserId: 'user-1',
        contentId: 'live-1',
        contentType: 'live',
      }),
    ).resolves.toEqual({ canView: false })
  })
})
