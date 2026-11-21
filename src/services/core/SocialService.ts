import { QueryOptions, UpdateQuery } from 'mongoose'
import { Comment, CommentModel } from '../../models/comments.model'
import { Rating, RatingModel } from '../../models/rating.model'
import { ReactionModel } from '../../models/reaction.model'
import { VideoRepo } from '../../repositories/VideoRepo'
import { OperationalError } from '../../utils/OperationalError'
import { VideoModel } from '../../models/videos.model'
import { EpisodeModel } from '../../models/episodes.model'
import { LiveModel } from '../../models/lives.model'
import { SeasonModel } from '../../models/seasons.model'
import { MaybeSession, withMongoDBSession } from '../../utils/mongoDbSessionRunner'
import { commentsParent } from '../../models/assets'
import { CommentsRepo } from '../../repositories/CommentsRepo'
import { ExpressRequestQuery, QueryParamsFeatures } from '../../utils/QueryParamsFeatures'

import { MongoDBObjectId } from '../../types/general'
import { RatingsRepo } from '../../repositories/ReatingsRepo'
import { PaymentService } from './PaymentService'

type UpdateRatingInput = {
  ratingId: string
  userId: string
  comment?: string
  rate?: number
}

type AddCommentInput = {
  message: string
  authorId: string
  parentType: string
  parentId: string
}

type AddReplyInput = { parentCommentId: string; parentReplyId?: string } & AddCommentInput

type AddReaction = {
  commentId: string
  reaction: string
  authorId: string
}

type IncCommentsCountInput = {
  comment: Comment
  session: MaybeSession
  action: 'CREATE' | 'DELETE'
  incCount: number
}

type GetCommentsInput = {
  parentId: string
  query: ExpressRequestQuery
  currentUserId: MongoDBObjectId
}

type GetCommentById = {
  currentUserId: MongoDBObjectId
  commentId: string
  type: string
}

type GetRepliesInput = Omit<GetCommentsInput, 'parentId'> & {
  commentId: string
}

type CreateRating = {
  rate: number
  parentType: string
  parentId: string
  comment?: string
  userId: string
}

export class SocialService {
  static CUReaction = async ({ commentId, reaction, authorId }: AddReaction) => {
    const commentExists = await CommentModel.exists({ _id: commentId })
    if (commentExists === null) {
      throw new OperationalError('Comment not found', 404)
    }

    const reactionDocument = await ReactionModel.findOneAndUpdate(
      {
        userId: authorId,
        commentId,
      },
      { reaction },
      { upsert: true, new: true },
    )

    if (reactionDocument == null) {
      throw new OperationalError('could not create reaction', 500)
    }

    return { reactionId: reactionDocument._id }
  }

  static deleteReaction = async (reactionId: string, userId: string) => {
    const reaction = await ReactionModel.findOneAndDelete({ _id: reactionId, userId })
    if (reaction === null) {
      throw new OperationalError('Reaction not found', 404)
    }
  }

  protected static _assertParentExists = async (parentType: string, parentId: string) => {
    const parentModels = {
      vod: VideoModel,
      episode: EpisodeModel,
      live: LiveModel,
      season: SeasonModel,
    } as const
    const model = parentModels[parentType as keyof typeof parentModels]

    if (model === undefined || (await model.exists({ _id: parentId })) === null) {
      throw new OperationalError('Comment parent not found', 404)
    }
  }

  protected static _enforceCommentRateLimit = async (authorId: string) => {
    const oneMinuteAgo = new Date(Date.now() - 60_000)
    const recentComments = await CommentModel.countDocuments({
      userId: authorId,
      createdAt: { $gte: oneMinuteAgo },
    })
    if (recentComments >= 10) {
      throw new OperationalError('Too many comments. Please wait a moment and try again.', 429)
    }
  }

  protected static _incParentCommentsCount = async ({
    comment,
    session,
    action,
    incCount,
  }: IncCommentsCountInput) => {
    const parentId = comment.parentId
    const isCreateAction = action === 'CREATE'
    const options: QueryOptions = { session }
    const update: UpdateQuery<any> = {
      $inc: { commentsCount: incCount },
    }

    switch (comment.parentType) {
      case 'vod':
        await VideoRepo.computeEngagements({
          by: incCount,
          session,
          id: parentId,
          property: 'commentsCount',
        })

        break

      case 'episode':
        await EpisodeModel.findByIdAndUpdate(parentId, update, options)
        break

      case 'live':
        await LiveModel.findByIdAndUpdate(parentId, update, options)
        break

      case 'season':
        await SeasonModel.findByIdAndUpdate(parentId, update, options)
        break
      default:
        if (isCreateAction) {
          throw new OperationalError(`Allowed parents type are ${commentsParent.join(' - ')}`, 400)
        }
        break
    }
  }

  protected static _addCommentTransaction = async (
    { message, parentId, parentType, authorId }: AddCommentInput,
    session: MaybeSession,
  ) => {
    await Promise.all([
      this._assertParentExists(parentType, parentId),
      this._enforceCommentRateLimit(authorId),
    ])

    const comment = await new CommentModel({
      userId: authorId,
      message: message.trim(),
      parentType,
      parentId,
    }).save({ session })

    await this._incParentCommentsCount({
      comment,
      session,
      action: 'CREATE',
      incCount: 1,
    })

    return comment
  }

  static addComment = async (input: AddCommentInput) =>
    await withMongoDBSession(this._addCommentTransaction, input)

  static _addReplyTransaction = async (
    { parentCommentId, message, authorId, parentType, parentId, parentReplyId }: AddReplyInput,
    session: MaybeSession,
  ) => {
    await Promise.all([
      this._assertParentExists(parentType, parentId),
      this._enforceCommentRateLimit(authorId),
    ])

    const parentComment = await CommentModel.findOne({
      _id: parentCommentId,
      parentId,
      parentType,
      parentCommentId: { $exists: false },
    })
    if (parentComment === null) {
      throw new OperationalError('Parent comment not found', 404)
    }

    if (parentReplyId) {
      const parentReply = await CommentModel.exists({
        _id: parentReplyId,
        parentCommentId,
        parentId,
        parentType,
      })
      if (parentReply === null) {
        throw new OperationalError('Parent reply not found', 404)
      }
    }

    const reply = await new CommentModel({
      userId: authorId,
      message: message.trim(),
      parentCommentId,
      parentReplyId,
      parentId,
      parentType,
    }).save({ session })

    await this._incParentCommentsCount({
      comment: reply,
      session,
      action: 'CREATE',
      incCount: 1,
    })

    return reply
  }

  static addReply = async (input: AddReplyInput) =>
    await withMongoDBSession(this._addReplyTransaction, input)

  static updateComment = async (commentId: string, message: string, userId: string) => {
    const comment = await CommentModel.findOneAndUpdate(
      { _id: commentId, userId },
      { message: message.trim() },
      { new: true, runValidators: true },
    )

    if (comment == null) {
      throw new OperationalError('Comment not found', 404)
    }

    return comment
  }

  protected static _deleteCommentTransaction = async (
    { commentId, userId }: { commentId: string; userId: string },
    session: MaybeSession,
  ) => {
    const deletedComment = await CommentModel.findOneAndDelete(
      { _id: commentId, userId },
      { session },
    )
    if (deletedComment === null) {
      throw new OperationalError('Comment not found', 404)
    }

    const replies = await CommentModel.find(
      { parentCommentId: deletedComment._id },
      { _id: 1 },
      { session },
    )
    const deletedIds = [deletedComment._id, ...replies.map(reply => reply._id)]
    await Promise.all([
      CommentModel.deleteMany({ _id: { $in: replies.map(reply => reply._id) } }, { session }),
      ReactionModel.deleteMany({ commentId: { $in: deletedIds } }, { session }),
    ])

    await this._incParentCommentsCount({
      comment: deletedComment,
      session,
      action: 'DELETE',
      incCount: -deletedIds.length,
    })
  }

  static deleteComment = async (commentId: string, userId: string) => {
    await withMongoDBSession(this._deleteCommentTransaction, { commentId, userId })
  }

  static getComments = async ({ query, parentId, currentUserId }: GetCommentsInput) => {
    const { skip, limit } = QueryParamsFeatures.paginagteParams(query)

    const comments = await CommentsRepo.getComments({
      parentId,
      userId: currentUserId,
      skip,
      limit,
    })

    return comments
  }

  static getReplies = async ({ commentId, query, currentUserId }: GetRepliesInput) => {
    const { skip, limit } = QueryParamsFeatures.paginagteParams(query)

    const replies = await CommentsRepo.getReplies({
      parentCommentId: commentId,
      userId: currentUserId,
      skip,
      limit,
    })

    return replies
  }

  protected static _computeRatingsParentStats = async (
    parentType: Rating['parentType'],
    parentId: Rating['parentId'],
  ) => {
    switch (parentType) {
      case 'vod':
        const [stats] = await RatingsRepo.parentRatingsStats(parentId.toString())
        const totalStats = stats?.totalStats[0]

        const result = await VideoModel.updateOne({ _id: parentId }, [
          {
            $set: {
              averageRating: totalStats?.averageRating ?? '$defaultRating',
              totalRatings: totalStats?.totalRatingsDocuments ?? 0,
            },
          },
        ])

        if (result.matchedCount === 0) {
          throw new OperationalError('Invalid vod id', 404)
        }

        break

      default:
        throw new OperationalError('Unsupported ratings parent', 404)
    }
  }

  // ********* Ratings
  static addRating = async ({ userId, rate, parentId, parentType, comment }: CreateRating) => {
    if (parentType !== 'vod') {
      throw new OperationalError('Only VOD ratings are currently supported', 400)
    }

    const video = await VideoModel.findById(parentId).select('vidClass').lean()
    if (video === null) {
      throw new OperationalError('Invalid vod id', 404)
    }

    if (video.vidClass === 'premium' || video.vidClass === 'exclusive') {
      const access = await PaymentService.checkHasValidContentPayment({
        currentUserId: userId,
        contentId: parentId,
        contentType: 'vod',
      })
      if (!access.canView) {
        throw new OperationalError('Watch access is required before rating this title', 403)
      }
    }

    const ratingsDocument = await RatingModel.findOneAndUpdate(
      {
        userId,
        parentId,
      },
      { parentType, comment, rate },
      { new: true, upsert: true, runValidators: true },
    )

    await this._computeRatingsParentStats(ratingsDocument.parentType, ratingsDocument.parentId)

    return ratingsDocument
  }

  static getRatings = async (parentId: string, userId?: string) => {
    const [[ratings], myRating] = await Promise.all([
      RatingsRepo.parentRatingsStats(parentId),
      userId
        ? RatingModel.findOne({ parentId, userId }).select('_id rate').lean()
        : Promise.resolve(null),
    ])

    return {
      totalStats: ratings?.totalStats ?? [],
      groupStats: ratings?.groupStats ?? [],
      myRating: myRating
        ? { _id: myRating._id.toString(), rate: myRating.rate }
        : null,
    }
  }

  static updateRating = async ({ ratingId, userId, comment, rate }: UpdateRatingInput) => {
    const ratingsDocument = await RatingModel.findOne({ _id: ratingId, userId })

    if (ratingsDocument === null) {
      throw new OperationalError('Rating not found', 404)
    }

    ratingsDocument.comment = comment ?? ratingsDocument.comment
    ratingsDocument.rate = rate ?? ratingsDocument.rate
    await ratingsDocument.save()
    await this._computeRatingsParentStats(ratingsDocument.parentType, ratingsDocument.parentId)
    return ratingsDocument
  }

  static deleteRating = async (ratingId: string, userId: string) => {
    const deletedRating = await RatingModel.findOneAndDelete({ _id: ratingId, userId })

    if (deletedRating === null) {
      throw new OperationalError('Rating not found', 404)
    }

    await this._computeRatingsParentStats(deletedRating.parentType, deletedRating.parentId)
  }

  static totalCommentsCount = async (vodId: string) => {
    const totalComments = await CommentModel.countDocuments({ parentId: vodId })
    return { totalComments }
  }
}
