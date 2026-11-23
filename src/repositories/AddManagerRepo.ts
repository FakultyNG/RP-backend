import { Aggregate, PipelineStage, Types } from 'mongoose'
import { AdModel, AdSchema } from '../models/admanager.model'
import { VideoUploadSchema } from '../models/videoupload.model'

interface FetchManyInput {
  skip: number
  limit: number
  type: unknown
}

export interface FetchAdResult extends Omit<AdSchema, 'videoUpload'> {
  _id: Types.ObjectId
  videoUpload?: VideoUploadSchema
}

export class AdManagerRepo {
  protected static _typeMatch = (type: unknown): PipelineStage.Match => {
    const match: PipelineStage.Match = { $match: {} }

    if (typeof type !== 'string' || type === 'all') {
      return match
    }

    match.$match.type = type
    return match
  }

  protected static _videoLookupPipeline = [
    {
      $lookup: {
        from: 'video_uploads',
        localField: 'videoUpload',
        foreignField: '_id',
        as: 'videoUpload',
      },
    },
    { $set: { videoUpload: { $first: '$videoUpload' } } },
  ]

  protected static _readyVideoPipeline = [
    {
      $lookup: {
        from: 'video_uploads',
        localField: 'videoUpload',
        foreignField: '_id',
        as: 'videoUpload',
        pipeline: [{ $match: { isTranscoded: true } }],
      },
    },
    { $set: { videoUpload: { $first: '$videoUpload' } } },
    { $match: { videoUpload: { $ne: null } } },
  ]

  static fetchMany = ({ skip, limit, type }: FetchManyInput) => {
    const res = AdModel.aggregate([
      this._typeMatch(type),
      ...this._videoLookupPipeline,
      { $sort: { _id: -1 } },
      { $skip: skip },
      { $limit: limit },
    ])

    return res as Aggregate<FetchAdResult[]>
  }

  static fetcRandom = (type: unknown) => {
    const now = new Date()
    const requestedType = typeof type === 'string' && type !== 'all' ? type : 'mobile'
    const res = AdModel.aggregate([
      {
        $match: {
          active: true,
          start: { $lte: now },
          expiry: { $gt: now },
          type: requestedType,
        },
      },
      ...this._readyVideoPipeline,
      // Preserve the random-on-each-request behaviour while returning enough
      // ads for clients to rotate continuously during the current session.
      { $sample: { size: 50 } },
    ])

    return res as Aggregate<FetchAdResult[]>
  }

  static fetchHomeAds = () => {
    const now = new Date()
    return AdModel.find({
      type: { $in: ['mobile', 'home_ad'] },
      active: true,
      start: { $lte: now },
      expiry: { $gt: now },
    }).sort({ createdAt: -1 })
  }
}
