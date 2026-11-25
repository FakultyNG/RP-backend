import { InferSchemaType, Schema, model } from 'mongoose'

const schema = new Schema(
  {
    key: {
      type: String,
      default: 'global',
      unique: true,
      immutable: true,
    },
    guestAccessEnabled: {
      type: Boolean,
      default: false,
      required: true,
    },
    liveEnabled: {
      type: Boolean,
      default: true,
      required: true,
    },
    liveUpdatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    liveUpdatedAt: {
      type: Date,
      default: null,
    },
    giftCardAuthorizationCodeHash: {
      type: String,
      select: false,
    },
  },
  { timestamps: true },
)

export const PlatformSettingsModel = model('platform_settings', schema)
export type PlatformSettingsSchema = InferSchemaType<typeof schema>
