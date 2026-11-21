import { Aggregate, PipelineStage, Types } from 'mongoose'
import { CommentModel } from '../models/comments.model'
import { MongoDBObjectId } from '../types/general'
import env from '../env'

type PageOptions = {
  skip: number
  limit: number
}

type GetCommentsAggeResInput = PageOptions & {
  match: PipelineStage.Match
  userId: MongoDBObjectId
}

type GetCommentsInput = PageOptions & {
  parentId: string
  userId: MongoDBObjectId
}

type GetRepliesInput = Omit<GetCommentsInput, 'parentId'> & {
  parentCommentId: string
}

export type GetCommentsResponse = {
  _id: string
  createdAt: string
  updatedAt: string
  commentId: string
  author: Author
  totalReactions: number
  totalReplies: number
  content: string
  totalEngagements: number
}

export type GetRepliesResponse = GetCommentsResponse & {
  _id: string
  parentCommentAuthor: Author
}

export type Author = {
  fullName: string
  photoURL: null | string
  userDocumentId: string
}

export class CommentsRepo {
  static fetchTotalRepliesCountByCommentId = (commentId: string) => {
    const res = CommentModel.aggregate([
      {
        $match: {
          _id: new Types.ObjectId(commentId),
        },
      },

      { $project: { _id: true } },

      {
        $lookup: {
          from: 'comments',
          localField: '_id',
          foreignField: 'parentCommentId',
          as: 'replies',
          pipeline: [{ $project: { _id: true } }],
        },
      },

      {
        $project: {
          totalReplies: { $size: '$replies' },
        },
      },
    ])

    return res as Aggregate<({ totalReplies: number; _id: MongoDBObjectId } | undefined)[]>
  }

  static getCommentById = (commentId: string, userId: MongoDBObjectId) => {
    return this._getCommentsRes({
      skip: 0,
      limit: 1,
      userId,
      match: {
        $match: { _id: new Types.ObjectId(commentId) },
      },
    })
  }

  static getReplyById = (commentId: string, userId: MongoDBObjectId) => {
    return this._getRepliesRes({
      skip: 0,
      limit: 1,
      userId,
      match: {
        $match: { _id: new Types.ObjectId(commentId) },
      },
    })
  }

  static getComments = ({ parentId, skip, limit, userId }: GetCommentsInput) => {
    return this._getCommentsRes({
      skip,
      limit,
      userId,
      match: {
        $match: { parentId: new Types.ObjectId(parentId) },
      },
    })
  }

  static getReplies = ({ parentCommentId, skip, limit, userId }: GetRepliesInput) => {
    return this._getRepliesRes({
      skip,
      limit,
      userId,
      match: {
        $match: { parentCommentId: new Types.ObjectId(parentCommentId) },
      },
    })
  }

  protected static _authorProjectionStage: PipelineStage.Project = {
    $project: {
      fullName: { $concat: ['$first_name', ' ', '$last_name'] },
      photoURL: {
        $cond: {
          if: { $eq: [{ $type: { $ifNull: ['$photo', null] } }, null] },
          then: null,
          else: { $concat: [env.CDN_IMAGES_BASE_URL, '/', '$photo.Key'] },
        },
      },
      userDocumentId: '$_id',
      _id: '$$REMOVE',
    },
  }

  static _getRepliesRes = ({ match, skip, limit, userId }: GetCommentsAggeResInput) => {
    const res = CommentModel.aggregate([
      { $match: { ...match.$match, parentCommentId: { $exists: true } } },
      // Page before joining users, parents and reactions. On popular content
      // this reduces the expensive part of the pipeline from every reply to
      // only the rows the device will actually render.
      { $sort: { _id: -1 } },
      { $skip: skip },
      { $limit: limit },

      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',

          pipeline: [this._authorProjectionStage],
        },
      },

      { $match: { 'user.0': { $exists: true } } },

      {
        $set: {
          originalParentCommentId: '$parentCommentId',

          parentCommentId: {
            $cond: {
              if: { $eq: [{ $ifNull: ['$parentReplyId', null] }, null] },
              then: '$parentCommentId',
              else: '$parentReplyId',
            },
          },
        },
      },

      {
        $lookup: {
          from: 'comments',
          localField: 'parentCommentId',
          foreignField: '_id',
          as: 'parentComment',

          pipeline: [
            {
              $lookup: {
                from: 'users',
                foreignField: '_id',
                localField: 'userId',
                as: 'parentCommentUser',
                pipeline: [this._authorProjectionStage],
              },
            },

            { $match: { 'parentCommentUser.0': { $exists: true } } },

            {
              $set: {
                user: { $first: '$parentCommentUser' },
              },
            },
          ],
        },
      },

      { $match: { 'parentComment.0': { $exists: true } } },

      {
        $lookup: {
          from: 'reactions',
          localField: '_id',
          foreignField: 'commentId',
          as: 'reactions',
          pipeline: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                userReactionId: {
                  $max: { $cond: [{ $eq: ['$userId', userId] }, '$_id', null] },
                },
              },
            },
          ],
        },
      },

      {
        $project: {
          author: { $first: '$user' },
          parentCommentAuthor: { $first: '$parentComment.user' },
          totalReactions: { $ifNull: [{ $first: '$reactions.total' }, 0] },
          parentCommentId: '$originalParentCommentId',
          reactionId: {
            $ifNull: [{ $first: '$reactions.userReactionId' }, null],
          },

          content: '$message',
          createdAt: true,
          updatedAt: true,
        },
      },
    ])

    return res as Aggregate<GetRepliesResponse[]>
  }

  static _getCommentsRes = ({ match, skip, limit, userId }: GetCommentsAggeResInput) => {
    const res = CommentModel.aggregate([
      { $match: { ...match.$match, parentCommentId: { $exists: false } } },
      { $sort: { _id: -1 } },
      { $skip: skip },
      { $limit: limit },

      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
          pipeline: [this._authorProjectionStage],
        },
      },

      { $match: { 'user.0': { $exists: true } } },

      {
        $lookup: {
          from: 'comments',
          localField: '_id',
          foreignField: 'parentCommentId',
          as: 'replies',
          pipeline: [{ $count: 'total' }],
        },
      },

      {
        $lookup: {
          from: 'reactions',
          localField: '_id',
          foreignField: 'commentId',
          as: 'reactions',
          pipeline: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                userReactionId: {
                  $max: { $cond: [{ $eq: ['$userId', userId] }, '$_id', null] },
                },
              },
            },
          ],
        },
      },

      {
        $project: {
          author: { $first: '$user' },

          reactionId: {
            $ifNull: [{ $first: '$reactions.userReactionId' }, null],
          },
          totalReactions: { $ifNull: [{ $first: '$reactions.total' }, 0] },
          totalReplies: { $ifNull: [{ $first: '$replies.total' }, 0] },
          content: '$message',
          createdAt: true,
          updatedAt: true,
        },
      },
    ])

    return res as Aggregate<GetCommentsResponse[]>
  }
}
