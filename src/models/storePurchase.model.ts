import { HydratedDocumentFromSchema, InferSchemaType, Schema, model } from 'mongoose'

const schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    videoId: { type: Schema.Types.ObjectId, ref: 'videos', required: true },
    seasonId: { type: Schema.Types.ObjectId, ref: 'seasons', default: null },
    provider: { type: String, enum: ['apple', 'google'], required: true },
    transactionId: { type: String, required: true },
    productId: { type: String, required: true },
    purchaseTokenHash: { type: String, select: false, index: true },
    status: { type: String, enum: ['processing', 'verified', 'revoked'], default: 'processing' },
    purchasedAt: { type: Date, required: true },
    storeEnvironment: String,
    storeOrderId: String,
    storefront: String,
    price: Number,
    currency: String,
    rawStorePayload: { type: Schema.Types.Mixed, select: false },
    verifiedAt: Date,
    revokedAt: Date,
    revocationReason: String,
  },
  { timestamps: true },
)

schema.index({ provider: 1, transactionId: 1 }, { unique: true })
schema.index({ userId: 1, createdAt: -1 })

export const StorePurchaseModel = model('store_purchases', schema)
export type StorePurchaseSchema = InferSchemaType<typeof schema>
export type StorePurchaseDocument = HydratedDocumentFromSchema<typeof schema>
