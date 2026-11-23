import { InferSchemaType, Schema, model } from 'mongoose'

const schema = new Schema(
  {
    adId: { type: Schema.Types.ObjectId, required: true, index: true },
    recipient: { type: String, required: true, lowercase: true, trim: true },
    delivery: { type: String, enum: ['live_link', 'csv'], required: true },
    frequency: { type: String, enum: ['daily', 'weekly', 'monthly', 'manual'], required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    sentAt: Date,
    error: { type: String, maxlength: 500 },
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: true },
)

schema.index({ adId: 1, createdAt: -1 })

export const AdReportDeliveryModel = model('ad_report_deliveries', schema)
export type AdReportDelivery = InferSchemaType<typeof schema>
