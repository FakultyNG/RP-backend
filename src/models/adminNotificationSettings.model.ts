import { Schema, model } from 'mongoose'
import { PhotoSchema } from './commonSchema'

const schema = new Schema(
  {
    key: { type: String, unique: true, default: 'global' },
    sound: PhotoSchema,
    soundName: String,
  },
  { timestamps: true, versionKey: false },
)

export const AdminNotificationSettingsModel = model('admin-notification-settings', schema)

