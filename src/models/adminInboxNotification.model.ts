import { InferSchemaType, Schema, model } from 'mongoose'

export const adminNotificationCategories = [
  'suggestions',
  'new_services',
  'upcoming_events',
  'new_arrivals',
  'live_channels',
  'system',
] as const

const schema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    category: { type: String, enum: adminNotificationCategories, required: true, index: true },
    route: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    seenBy: [{ type: Schema.Types.ObjectId, ref: 'users' }],
  },
  { timestamps: true, versionKey: false },
)

schema.index({ createdAt: -1 })
schema.index({ seenBy: 1, createdAt: -1 })

export const AdminInboxNotificationModel = model('admin-inbox-notifications', schema)
export type AdminInboxNotificationSchema = InferSchemaType<typeof schema>

