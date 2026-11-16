import { Schema, model } from 'mongoose'

const schema = new Schema(
  {
    connectionId: { type: String, required: true },
    viewer: { type: Schema.Types.ObjectId, ref: 'users', required: true },
    content: { type: Schema.Types.ObjectId, ref: 'lives', required: true },
  },
  { timestamps: true },
)

schema.index({ connectionId: 1, content: 1 }, { unique: true })

export const LiveViewerPresenceModel = model('live_viewer_presences', schema)
