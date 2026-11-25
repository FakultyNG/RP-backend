import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { GoogleAuth, OAuth2Client } from 'google-auth-library'
import env from '../../env'
import { ContentEntitlementModel } from '../../models/contentEntitlement.model'
import { SeasonModel } from '../../models/seasons.model'
import { StorePurchaseModel } from '../../models/storePurchase.model'
import { VideoModel } from '../../models/videos.model'
import { LoggedInUser, StringOrObjectId } from '../../types'
import { denyGuestUser } from '../../utils/denyGuestUser'
import { OperationalError } from '../../utils/OperationalError'

type StoreProvider = 'apple' | 'google'
type PurchaseTarget = 'movie' | 'season'

interface StorePurchaseInput {
  currentUser: LoggedInUser
  provider: StoreProvider
  productId: string
  transactionId?: string
  purchaseToken?: string
  videoId: string
  seasonId?: string
}

type VerifiedStoreTransaction = {
  transactionId: string
  productId: string
  purchasedAt: Date
  environment?: string
  orderId?: string
  storefront?: string
  price?: number
  currency?: string
  raw: Record<string, unknown>
}

const addAccessDays = (date: Date) => {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + env.CONTENT_ACCESS_DAYS)
  return next
}

const accountHash = (userId: StringOrObjectId) =>
  crypto.createHash('sha256').update(userId.toString()).digest('hex')

const appleAccountToken = (userId: StringOrObjectId) => {
  const hex = accountHash(userId).slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

const decodeJwsPayload = (value: string) => {
  const payload = value.split('.')[1]
  if (!payload) throw new OperationalError('Apple returned an invalid signed transaction', 502)
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, any>
}

export class StorePurchaseService {
  private static productId(provider: StoreProvider, target: PurchaseTarget) {
    if (provider === 'apple') {
      return target === 'season' ? env.APPLE_SEASON_PRODUCT_ID : env.APPLE_MOVIE_PRODUCT_ID
    }
    return target === 'season' ? env.GOOGLE_SEASON_PRODUCT_ID : env.GOOGLE_MOVIE_PRODUCT_ID
  }

  private static async resolveTarget(videoId: string, seasonId?: string) {
    const video = await VideoModel.findById(videoId).select(
      'type vidClass isReeplayOriginal title active',
    )
    if (!video || !video.active) throw new OperationalError('Content is unavailable', 404)
    if (video.vidClass !== 'premium') {
      throw new OperationalError('Only premium content requires payment', 400)
    }

    if (video.type === 'series') {
      if (!seasonId) throw new OperationalError('Select a season to continue', 400)
      const season = await SeasonModel.findOne({ _id: seasonId, video: video._id }).select(
        '_id serial_number video',
      )
      if (!season) throw new OperationalError('Season was not found for this series', 404)
      return { video, season, target: 'season' as const }
    }

    if (seasonId) throw new OperationalError('A season is only valid for series', 400)
    return { video, season: null, target: 'movie' as const }
  }

  static getProductsForContent = async ({
    currentUser,
    videoId,
    seasonId,
  }: {
    currentUser: LoggedInUser
    videoId: string
    seasonId?: string
  }) => {
    denyGuestUser(currentUser)
    const { video, season, target } = await this.resolveTarget(videoId, seasonId)
    return {
      target,
      videoId: video._id,
      seasonId: season?._id ?? null,
      accessDays: env.CONTENT_ACCESS_DAYS,
      referencePrice: {
        amount:
          target === 'season' ? env.PREMIUM_SEASON_PRICE_USD : env.PREMIUM_MOVIE_PRICE_USD,
        currency: 'USD',
      },
      products: {
        apple: this.productId('apple', target),
        google: this.productId('google', target),
      },
      accountTokens: {
        apple: appleAccountToken(currentUser._id),
        google: accountHash(currentUser._id),
      },
    }
  }

  private static appleApiToken() {
    if (!env.APPLE_IAP_ISSUER_ID || !env.APPLE_IAP_KEY_ID || !env.APPLE_IAP_PRIVATE_KEY_BASE64) {
      throw new OperationalError('Apple purchase verification is not configured', 503)
    }
    const privateKey = Buffer.from(env.APPLE_IAP_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
    return jwt.sign({}, privateKey, {
      algorithm: 'ES256',
      issuer: env.APPLE_IAP_ISSUER_ID,
      audience: 'appstoreconnect-v1',
      expiresIn: '10m',
      keyid: env.APPLE_IAP_KEY_ID,
      header: { alg: 'ES256', kid: env.APPLE_IAP_KEY_ID, typ: 'JWT' },
    })
  }

  private static verifyApple = async (
    input: StorePurchaseInput,
  ): Promise<VerifiedStoreTransaction> => {
    if (!input.transactionId) throw new OperationalError('Apple transactionId is required', 400)
    const token = this.appleApiToken()
    const bases = [
      'https://api.storekit.apple.com',
      'https://api.storekit-sandbox.apple.com',
    ]
    let response: Response | undefined
    for (const base of bases) {
      response = await fetch(
        `${base}/inApps/v1/transactions/${encodeURIComponent(input.transactionId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (response.ok || response.status !== 404) break
    }
    if (!response?.ok) {
      throw new OperationalError('Apple could not verify this purchase', 400)
    }
    const result = (await response.json()) as { signedTransactionInfo?: string }
    if (!result.signedTransactionInfo) {
      throw new OperationalError('Apple returned no transaction information', 502)
    }
    const payload = decodeJwsPayload(result.signedTransactionInfo)
    if (payload.bundleId !== env.APPLE_BUNDLE_ID) {
      throw new OperationalError('Apple purchase belongs to a different app', 403)
    }
    if (payload.productId !== input.productId || payload.transactionId !== input.transactionId) {
      throw new OperationalError('Apple purchase details do not match', 403)
    }
    if (payload.revocationDate) throw new OperationalError('Apple purchase was refunded', 403)
    if (payload.appAccountToken !== appleAccountToken(input.currentUser._id)) {
      throw new OperationalError('Apple purchase belongs to a different Reeplay account', 403)
    }
    return {
      transactionId: payload.transactionId,
      productId: payload.productId,
      purchasedAt: new Date(payload.purchaseDate),
      environment: payload.environment,
      storefront: payload.storefront,
      price: typeof payload.price === 'number' ? payload.price / 1000 : undefined,
      currency: payload.currency,
      raw: payload,
    }
  }

  private static googleAuth() {
    if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT_BASE64) {
      throw new OperationalError('Google Play purchase verification is not configured', 503)
    }
    const credentials = JSON.parse(
      Buffer.from(env.GOOGLE_PLAY_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'),
    )
    return new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    })
  }

  private static verifyGooglePubSubAuthorization = async (authorization?: string) => {
    const audience = env.GOOGLE_PUBSUB_AUDIENCE
    const expectedEmail = env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL
    if (!audience && !expectedEmail) return
    if (!audience || !expectedEmail) {
      throw new OperationalError('Google Pub/Sub authentication is not fully configured', 503)
    }

    const match = authorization?.match(/^Bearer\s+(.+)$/i)
    if (!match?.[1]) throw new OperationalError('Google Pub/Sub authorization is required', 401)

    try {
      const ticket = await new OAuth2Client().verifyIdToken({
        idToken: match[1],
        audience,
      })
      const payload = ticket.getPayload()
      if (!payload?.email_verified || payload.email !== expectedEmail) {
        throw new Error('Unexpected Pub/Sub push identity')
      }
    } catch {
      throw new OperationalError('Google Pub/Sub authorization is invalid', 401)
    }
  }

  private static verifyGoogle = async (
    input: StorePurchaseInput,
  ): Promise<VerifiedStoreTransaction> => {
    if (!input.purchaseToken) throw new OperationalError('Google purchaseToken is required', 400)
    const accessToken = await this.googleAuth().getAccessToken()
    const url =
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
      `${encodeURIComponent(env.GOOGLE_PLAY_PACKAGE_NAME)}/purchases/products/` +
      `${encodeURIComponent(input.productId)}/tokens/${encodeURIComponent(input.purchaseToken)}`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!response.ok) throw new OperationalError('Google Play could not verify this purchase', 400)
    const payload = (await response.json()) as Record<string, any>
    if (payload.purchaseState !== 0) {
      throw new OperationalError('Google Play purchase is not completed', 409)
    }
    if (payload.productId && payload.productId !== input.productId) {
      throw new OperationalError('Google Play product does not match', 403)
    }
    if (payload.obfuscatedExternalAccountId !== accountHash(input.currentUser._id)) {
      throw new OperationalError('Google Play purchase belongs to a different Reeplay account', 403)
    }
    return {
      transactionId: payload.orderId ?? crypto.createHash('sha256').update(input.purchaseToken).digest('hex'),
      orderId: payload.orderId,
      productId: input.productId,
      purchasedAt: new Date(Number(payload.purchaseTimeMillis)),
      environment: payload.purchaseType === 0 ? 'Test' : 'Production',
      storefront: payload.regionCode,
      raw: payload,
    }
  }

  private static grantEntitlement = async ({
    currentUser,
    provider,
    videoId,
    seasonId,
    transaction,
  }: StorePurchaseInput & { transaction: VerifiedStoreTransaction }) => {
    const now = new Date()
    const existing = await ContentEntitlementModel.findOne({
      userId: currentUser._id,
      videoId,
      seasonId: seasonId ?? null,
    })
    const startsFrom = existing?.status === 'active' && existing.accessEndsAt > now
      ? existing.accessEndsAt
      : now
    const accessEndsAt = addAccessDays(startsFrom)
    return ContentEntitlementModel.findOneAndUpdate(
      { userId: currentUser._id, videoId, seasonId: seasonId ?? null },
      {
        $set: {
          entitlementType: seasonId ? 'season' : 'movie',
          purchaseSource: provider,
          latestTransactionId: transaction.transactionId,
          accessStartsAt: existing?.accessStartsAt ?? now,
          accessEndsAt,
          status: 'active',
        },
        $unset: { revokedAt: 1, revocationReason: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }

  static verifyAndGrant = async (input: StorePurchaseInput) => {
    denyGuestUser(input.currentUser)
    const { target, season } = await this.resolveTarget(input.videoId, input.seasonId)
    if (input.productId !== this.productId(input.provider, target)) {
      throw new OperationalError('Incorrect store product for this content', 400)
    }
    const transaction =
      input.provider === 'apple' ? await this.verifyApple(input) : await this.verifyGoogle(input)

    const existingPurchase = await StorePurchaseModel.findOne({
      provider: input.provider,
      transactionId: transaction.transactionId,
    })
    if (existingPurchase) {
      if (existingPurchase.userId.toString() !== input.currentUser._id.toString()) {
        throw new OperationalError('This store transaction has already been claimed', 409)
      }
      const entitlement = await ContentEntitlementModel.findOne({
        userId: input.currentUser._id,
        videoId: input.videoId,
        seasonId: season?._id ?? null,
      })
      return { entitlement, duplicate: true }
    }

    const purchase = await StorePurchaseModel.create({
      userId: input.currentUser._id,
      videoId: input.videoId,
      seasonId: season?._id ?? null,
      provider: input.provider,
      transactionId: transaction.transactionId,
      productId: transaction.productId,
      purchaseTokenHash: input.purchaseToken
        ? crypto.createHash('sha256').update(input.purchaseToken).digest('hex')
        : undefined,
      status: 'processing',
      purchasedAt: transaction.purchasedAt,
      storeEnvironment: transaction.environment,
      storeOrderId: transaction.orderId,
      storefront: transaction.storefront,
      price: transaction.price,
      currency: transaction.currency,
      rawStorePayload: transaction.raw,
    })
    try {
      const entitlement = await this.grantEntitlement({
        ...input,
        seasonId: season?._id.toString(),
        transaction,
      })
      purchase.status = 'verified'
      purchase.verifiedAt = new Date()
      await purchase.save()
      return { entitlement, duplicate: false }
    } catch (error) {
      await StorePurchaseModel.deleteOne({ _id: purchase._id, status: 'processing' })
      throw error
    }
  }

  static hasAccess = async ({
    currentUserId,
    videoId,
    seasonId,
  }: {
    currentUserId: StringOrObjectId
    videoId: string
    seasonId?: string
  }) => {
    const entitlement = await ContentEntitlementModel.findOne({
      userId: currentUserId,
      videoId,
      seasonId: seasonId ?? null,
      status: 'active',
      accessEndsAt: { $gt: new Date() },
    }).select('accessEndsAt purchaseSource entitlementType')
    return {
      canView: Boolean(entitlement),
      accessEndsAt: entitlement?.accessEndsAt ?? null,
      purchaseSource: entitlement?.purchaseSource ?? null,
    }
  }

  private static revokePurchase = async (purchase: any, reason: string) => {
    purchase.status = 'revoked'
    purchase.revokedAt = new Date()
    purchase.revocationReason = reason
    await purchase.save()
    await ContentEntitlementModel.updateOne(
      {
        userId: purchase.userId,
        videoId: purchase.videoId,
        seasonId: purchase.seasonId ?? null,
        latestTransactionId: purchase.transactionId,
      },
      { $set: { status: 'revoked', revokedAt: new Date(), revocationReason: reason } },
    )
  }

  static reconcileAppleNotification = async (signedPayload: string) => {
    if (!signedPayload) throw new OperationalError('signedPayload is required', 400)
    const outer = decodeJwsPayload(signedPayload)
    const signedTransaction = outer?.data?.signedTransactionInfo
    if (typeof signedTransaction !== 'string') return { ignored: true }
    const hinted = decodeJwsPayload(signedTransaction)
    if (!hinted.transactionId) return { ignored: true }

    const token = this.appleApiToken()
    let response: Response | undefined
    for (const base of ['https://api.storekit.apple.com', 'https://api.storekit-sandbox.apple.com']) {
      response = await fetch(`${base}/inApps/v1/transactions/${encodeURIComponent(hinted.transactionId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.ok || response.status !== 404) break
    }
    if (!response?.ok) throw new OperationalError('Apple notification could not be verified', 400)
    const result = (await response.json()) as { signedTransactionInfo?: string }
    if (!result.signedTransactionInfo) throw new OperationalError('Apple returned no transaction', 502)
    const verified = decodeJwsPayload(result.signedTransactionInfo)
    if (verified.bundleId !== env.APPLE_BUNDLE_ID) {
      throw new OperationalError('Apple notification belongs to a different app', 403)
    }
    const purchase = await StorePurchaseModel.findOne({
      provider: 'apple',
      transactionId: verified.transactionId,
    })
    if (!purchase) return { ignored: true }
    if (verified.revocationDate || ['REFUND', 'REVOKE'].includes(String(outer.notificationType))) {
      await this.revokePurchase(purchase, String(outer.notificationType ?? 'Apple refund'))
      return { revoked: true }
    }
    return { revoked: false }
  }

  static reconcileGoogleNotification = async (encodedData: string, authorization?: string) => {
    await this.verifyGooglePubSubAuthorization(authorization)
    if (!encodedData) throw new OperationalError('Google Pub/Sub data is required', 400)
    let notification: Record<string, any>
    try {
      notification = JSON.parse(Buffer.from(encodedData, 'base64').toString('utf8'))
    } catch {
      throw new OperationalError('Google Pub/Sub data is invalid', 400)
    }
    if (notification.packageName !== env.GOOGLE_PLAY_PACKAGE_NAME) {
      throw new OperationalError('Google notification belongs to a different app', 403)
    }
    if (notification.testNotification) return { ignored: true, test: true }

    const productNotification = notification.oneTimeProductNotification
    const voidedNotification = notification.voidedPurchaseNotification
    const purchaseToken = productNotification?.purchaseToken ?? voidedNotification?.purchaseToken
    const notifiedProductId = productNotification?.sku
    if (!purchaseToken || (!productNotification && !voidedNotification)) return { ignored: true }

    const tokenHash = crypto.createHash('sha256').update(purchaseToken).digest('hex')
    const purchase = await StorePurchaseModel.findOne({
      provider: 'google',
      ...(notifiedProductId ? { productId: notifiedProductId } : {}),
      purchaseTokenHash: tokenHash,
    }).select('+purchaseTokenHash')
    if (!purchase) return { ignored: true }
    if (purchase.status === 'revoked') return { revoked: true, duplicate: true }

    const accessToken = await this.googleAuth().getAccessToken()
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(env.GOOGLE_PLAY_PACKAGE_NAME)}/purchases/products/${encodeURIComponent(purchase.productId)}/tokens/${encodeURIComponent(purchaseToken)}`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!response.ok) throw new OperationalError('Google notification could not be verified', 400)
    const state = (await response.json()) as Record<string, any>
    const storeHasRevokedPurchase = Number(state.purchaseState) !== 0
    const notificationReportsRevocation =
      Boolean(voidedNotification) || Number(productNotification?.notificationType) === 2

    if (notificationReportsRevocation && !storeHasRevokedPurchase) {
      throw new OperationalError('Google Play has not confirmed the revocation yet', 409)
    }
    if (storeHasRevokedPurchase) {
      const reason = voidedNotification
        ? `Google voided purchase (refund type ${voidedNotification.refundType ?? 'unknown'})`
        : `Google notification ${productNotification?.notificationType ?? 'unknown'}`
      await this.revokePurchase(purchase, reason)
      return { revoked: true }
    }
    return { revoked: false }
  }
}
