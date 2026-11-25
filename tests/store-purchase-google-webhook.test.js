const crypto = require('node:crypto')

const mockStorePurchaseFindOne = jest.fn()
const mockEntitlementUpdateOne = jest.fn()
const mockGetAccessToken = jest.fn()
const mockVerifyIdToken = jest.fn()
const mockEnv = {
  CONTENT_ACCESS_DAYS: 30,
  GOOGLE_PLAY_PACKAGE_NAME: 'com.reeplayv2',
  GOOGLE_PLAY_SERVICE_ACCOUNT_BASE64: Buffer.from(JSON.stringify({ client_email: 'test' })).toString(
    'base64',
  ),
  GOOGLE_PUBSUB_AUDIENCE: '',
  GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL: '',
}

jest.mock('../build/src/env', () => ({
  __esModule: true,
  default: mockEnv,
}))

jest.mock('../build/src/models/storePurchase.model', () => ({
  StorePurchaseModel: { findOne: mockStorePurchaseFindOne },
}))

jest.mock('../build/src/models/contentEntitlement.model', () => ({
  ContentEntitlementModel: { updateOne: mockEntitlementUpdateOne },
}))

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({ getAccessToken: mockGetAccessToken })),
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken })),
}))

const { StorePurchaseService } = require('../build/src/services/core/StorePurchaseService')

const encodeNotification = (notification) =>
  Buffer.from(JSON.stringify(notification), 'utf8').toString('base64')

const createPurchase = () => ({
  userId: 'user-1',
  videoId: 'video-1',
  seasonId: null,
  transactionId: 'transaction-1',
  productId: 'reeplay_ppv_movie_30d',
  status: 'verified',
  save: jest.fn().mockResolvedValue(undefined),
})

describe('Google Play real-time developer notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEnv.GOOGLE_PUBSUB_AUDIENCE = ''
    mockEnv.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = ''
    mockGetAccessToken.mockResolvedValue('publisher-access-token')
    mockEntitlementUpdateOne.mockResolvedValue({ modifiedCount: 1 })
    global.fetch = jest.fn()
  })

  afterAll(() => {
    delete global.fetch
  })

  test('acknowledges a Play Console test notification without touching purchases', async () => {
    const result = await StorePurchaseService.reconcileGoogleNotification(
      encodeNotification({
        packageName: 'com.reeplayv2',
        testNotification: { version: '1.0' },
      }),
    )

    expect(result).toEqual({ ignored: true, test: true })
    expect(mockStorePurchaseFindOne).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('re-checks and revokes a voided one-time purchase', async () => {
    const purchase = createPurchase()
    const select = jest.fn().mockResolvedValue(purchase)
    mockStorePurchaseFindOne.mockReturnValue({ select })
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ purchaseState: 1 }),
    })

    const result = await StorePurchaseService.reconcileGoogleNotification(
      encodeNotification({
        packageName: 'com.reeplayv2',
        voidedPurchaseNotification: {
          purchaseToken: 'purchase-token-1',
          orderId: 'order-1',
          productType: 2,
          refundType: 1,
        },
      }),
    )

    expect(result).toEqual({ revoked: true })
    expect(mockStorePurchaseFindOne).toHaveBeenCalledWith({
      provider: 'google',
      purchaseTokenHash: crypto.createHash('sha256').update('purchase-token-1').digest('hex'),
    })
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/purchases/products/reeplay_ppv_movie_30d/tokens/purchase-token-1'),
      { headers: { Authorization: 'Bearer publisher-access-token' } },
    )
    expect(purchase.status).toBe('revoked')
    expect(purchase.revocationReason).toBe('Google voided purchase (refund type 1)')
    expect(purchase.save).toHaveBeenCalled()
    expect(mockEntitlementUpdateOne).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        videoId: 'video-1',
        seasonId: null,
        latestTransactionId: 'transaction-1',
      },
      { $set: expect.objectContaining({ status: 'revoked' }) },
    )
  })

  test('asks Pub/Sub to retry while Google still reports the purchase as active', async () => {
    const purchase = createPurchase()
    mockStorePurchaseFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(purchase),
    })
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ purchaseState: 0 }),
    })

    await expect(
      StorePurchaseService.reconcileGoogleNotification(
        encodeNotification({
          packageName: 'com.reeplayv2',
          voidedPurchaseNotification: { purchaseToken: 'purchase-token-1', refundType: 1 },
        }),
      ),
    ).rejects.toThrow('Google Play has not confirmed the revocation yet')

    expect(purchase.save).not.toHaveBeenCalled()
    expect(mockEntitlementUpdateOne).not.toHaveBeenCalled()
  })

  test('verifies the authenticated Pub/Sub push identity when configured', async () => {
    mockEnv.GOOGLE_PUBSUB_AUDIENCE =
      'https://reeplay-api-ts-production.up.railway.app/api/v1/webhooks/store/google'
    mockEnv.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL =
      'reeplay-pubsub-push@example.iam.gserviceaccount.com'
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: 'reeplay-pubsub-push@example.iam.gserviceaccount.com',
        email_verified: true,
      }),
    })

    await expect(
      StorePurchaseService.reconcileGoogleNotification(
        encodeNotification({
          packageName: 'com.reeplayv2',
          testNotification: { version: '1.0' },
        }),
        'Bearer signed-pubsub-token',
      ),
    ).resolves.toEqual({ ignored: true, test: true })

    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-pubsub-token',
      audience: mockEnv.GOOGLE_PUBSUB_AUDIENCE,
    })
  })
})
