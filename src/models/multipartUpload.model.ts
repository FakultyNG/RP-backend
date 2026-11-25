import { InferSchemaType, Schema, model } from 'mongoose'

const schema = new Schema(
  {
    adminId: { type: Schema.Types.ObjectId, required: true, index: true },
    uploadId: { type: String, required: true },
    bucket: { type: String, required: true },
    key: { type: String, required: true, unique: true },
    fileName: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    partSize: { type: Number, required: true },
    totalParts: { type: Number, required: true },
    mediaKind: { type: String, enum: ['main', 'trailer'], required: true },
    target: { type: String, enum: ['vod', 'episode'], required: true },
    status: {
      type: String,
      enum: ['active', 'uploaded', 'completed', 'aborted'],
      default: 'active',
      required: true,
    },
    videoUploadId: { type: Schema.Types.ObjectId, ref: 'video_uploads' },
    claimedAt: { type: Date, default: null },
    claimedParentId: { type: Schema.Types.ObjectId, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
)

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: '_multipartUploadExpiry' })
schema.index({ adminId: 1, status: 1, createdAt: -1 })

export const MultipartUploadModel = model('multipart_uploads', schema)
export type MultipartUploadSchema = InferSchemaType<typeof schema>
