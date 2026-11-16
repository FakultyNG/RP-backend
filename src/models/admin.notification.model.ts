import { InferSchemaType, Schema, model } from 'mongoose'
import { PhotoSchema } from './commonSchema'

const schema = new Schema(
  {
    admin: {
      type: Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
    },

    description: {
      type: String,
    },

    type: {
      type: String,
      default: 'MAIN_ADMIN_TOPIC_NOTIFICATION',
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    photo: PhotoSchema,
  },
  { timestamps: true, versionKey: false },
)

export const AdminNotificationModel = model('admin-notifications', schema)
export type AdminNotificationSchema = InferSchemaType<typeof schema>
