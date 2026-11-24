import { HydratedDocumentFromSchema, InferSchemaType, Schema, model } from 'mongoose'

const schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    videoId: { type: Schema.Types.ObjectId, ref: 'videos', required: true, index: true },
    seasonId: { type: Schema.Types.ObjectId, ref: 'seasons', default: null, index: true },
    entitlementType: { type: String, enum: ['movie', 'season'], required: true },
    purchaseSource: {
      type: String,
      enum: ['apple', 'google', 'web_wallet', 'gift_card', 'legacy'],
      required: true,
    },
    latestTransactionId: { type: String, required: true },
    accessStartsAt: { type: Date, required: true },
    accessEndsAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ['active', 'revoked'], default: 'active', index: true },
    revokedAt: Date,
    revocationReason: String,
  },
  { timestamps: true },
)

schema.index({ userId: 1, videoId: 1, seasonId: 1 }, { unique: true })
schema.index({ userId: 1, status: 1, accessEndsAt: 1 })

export const ContentEntitlementModel = model('content_entitlements', schema)
export type ContentEntitlementSchema = InferSchemaType<typeof schema>
export type ContentEntitlementDocument = HydratedDocumentFromSchema<typeof schema>
