import { validate } from '../../middlewares/requestValidator'
import { VideoModel, videoTypes } from '../../models/videos.model'
import { AdminUploadService } from '../../services/core/AdminUploadService'
import { PaymentService } from '../../services/core/PaymentService'

import { Catch } from '../../utils/Catch'
import { GetDefined } from '../../utils/GetDefined'
import { OperationalError } from '../../utils/OperationalError'
import { sendResponse } from '../../utils/responder'
import { AllVideoTypes, MovieData, UploadMediaUtils } from '../../utils/UploadMediaUtils'
import { addEpisodeSchema, editEpisodeSchema, editVideoSchema } from '../../validations/admin'
import { isGuestUser } from '../../utils/guestAccess'
import { MultipartUploadService } from '../../services/core/MultipartUploadService'

export class AdminUploadController {
  static initiateMultipartUpload = Catch.async(async ({ body, user }, res) => {
    const admin = GetDefined.loggedInUser(user)
    const { fileName, contentType, size, mediaKind, target } = body
    if (
      typeof fileName !== 'string' ||
      typeof contentType !== 'string' ||
      !Number.isSafeInteger(size) ||
      !['main', 'trailer'].includes(mediaKind) ||
      !['vod', 'episode'].includes(target)
    ) {
      throw new OperationalError('fileName, contentType, integer size, mediaKind, and target are required', 400)
    }
    sendResponse({
      res,
      message: 'Multipart upload started',
      data: await MultipartUploadService.initiate({
        adminId: admin.id,
        fileName,
        contentType,
        size,
        mediaKind,
        target,
      }),
    })
  })

  static signMultipartParts = Catch.async(async ({ params, body, user }, res) => {
    if (!Array.isArray(body.partNumbers)) {
      throw new OperationalError('partNumbers must be an array', 400)
    }
    sendResponse({
      res,
      data: await MultipartUploadService.signParts(
        params.sessionId,
        GetDefined.loggedInUser(user).id,
        body.partNumbers,
      ),
    })
  })

  static multipartUploadStatus = Catch.async(async ({ params, user }, res) => {
    sendResponse({
      res,
      data: await MultipartUploadService.status(
        params.sessionId,
        GetDefined.loggedInUser(user).id,
      ),
    })
  })

  static completeMultipartUpload = Catch.async(async ({ params, user }, res) => {
    sendResponse({
      res,
      message: 'Upload completed; HLS processing has started',
      data: await MultipartUploadService.complete(
        params.sessionId,
        GetDefined.loggedInUser(user).id,
      ),
    })
  })

  static abortMultipartUpload = Catch.async(async ({ params, user }, res) => {
    await MultipartUploadService.abort(params.sessionId, GetDefined.loggedInUser(user).id)
    sendResponse({ res, message: 'Upload aborted' })
  })

  private static _validateVideoType = (type: string) => {
    if (!videoTypes.includes(type as any)) {
      throw new OperationalError(`Valid video types are ${videoTypes.join(' || ')} `, 400)
    }

    return type as AllVideoTypes
  }

  static addVideo = Catch.async(async ({ files: reqFiles, body, user, params }, res) => {
    const type = this._validateVideoType(params.type)
    const admin = GetDefined.loggedInUser(user)

    const { data: _data } = body

    if (_data == null || typeof _data !== 'string') {
      throw new OperationalError(
        'formData.data is required and must be a JSON serialized string',
        400,
      )
    }

    const files = UploadMediaUtils.checkFiles(reqFiles)

    if (Object.keys(files).length === 0) {
      throw new OperationalError('Expected at least one file', 400)
    }

    const data: MovieData = {
      ...JSON.parse(body.data),
      landscapePoster: files.landscapePoster?.[0],
      portraitPoster: files.portraitPoster?.[0],
      trailer: files.trailer?.[0],
    }

    UploadMediaUtils.validateAddMovieData(type, data, files)

    const vod = await AdminUploadService.addVideo({
      type,
      data: data,
      adminId: admin.id,
    })

    sendResponse({
      res,
      message: `${type} added successfully`,
      data: vod,
    })
  })

  static addSeason = Catch.async(async ({ body, user, params }, res) => {
    if (body.description && typeof body.description !== 'string') {
      throw new OperationalError('optional body.description must be a string when provided', 400)
    }

    sendResponse({
      res,
      message: `season added successfully`,
      data: await AdminUploadService.addSeason({
        description: body.description,
        videoId: params.videoId,
        adminId: GetDefined.loggedInUser(user).id,
      }),
    })
  })

  static canAddSeason = Catch.async(async ({ params }, res) => {
    await AdminUploadService.canAddSeason(params.videoId)

    sendResponse({
      res,
      message: 'Success',
      data: { canAdd: true },
    })
  })

  static canAddEpisode = Catch.async(async ({ params }, res) => {
    await AdminUploadService.canAddEpisode(params.seasonId)

    sendResponse({
      res,
      message: 'Success',
      data: { canAdd: true },
    })
  })

  static addEpisode = Catch.async(async (req, res) => {
    if (req.body.data == null || typeof req.body.data !== 'string') {
      throw new OperationalError(
        'formData.data is required and must be a JSON serialized string',
        400,
      )
    }

    const data = {
      ...JSON.parse(req.body.data),
    }

    if (!!req.files) {
      const files = UploadMediaUtils.checkFiles(req.files)

      Object.assign(data, {
        trailer: files.trailer?.[0],
        video: files.video?.[0],
      })
    }

    validate(addEpisodeSchema, data)

    sendResponse({
      res,
      message: 'episode added successfully',
      data: await AdminUploadService.addEpisode({
        seasonId: req.params.seasonId,
        adminId: GetDefined.loggedInUser(req.user).id,
        data,
      }),
    })
  })

  static editEpisode = Catch.async(async (req, res) => {
    if (req.body.data == null || typeof req.body.data !== 'string') {
      throw new OperationalError(
        'formData.data is required and must be a JSON serialized string',
        400,
      )
    }

    const data = { ...JSON.parse(req.body.data) }
    const files = UploadMediaUtils.checkFiles(req.files)
    Object.assign(data, {
      trailer: files.trailer?.[0],
      video: files.video?.[0],
    })
    validate(editEpisodeSchema, data)

    sendResponse({
      res,
      message: 'episode updated successfully',
      data: await AdminUploadService.editEpisode({
        episodeId: req.params.episodeId,
        adminId: GetDefined.loggedInUser(req.user).id,
        data,
      }),
    })
  })

  static deleteEpisode = Catch.async(async ({ params }, res) => {
    await AdminUploadService.deleteEpisode(params.episodeId)
    sendResponse({ res, message: 'episode deleted successfully' })
  })

  static deleteSeason = Catch.async(async ({ params }, res) => {
    await AdminUploadService.deleteSeason(params.seasonId)
    sendResponse({ res, message: 'season deleted successfully' })
  })

  static editVideo = Catch.async(async ({ params, body, user, files: reqFiles }, res) => {
    if (body.data != null && typeof body.data !== 'string') {
      throw new OperationalError('optional formData.data must be a JSON serialized string', 400)
    }

    const files = UploadMediaUtils.checkFiles(reqFiles)

    const data: Partial<MovieData> = {
      landscapePoster: files.landscapePoster?.[0],
      portraitPoster: files.portraitPoster?.[0],
      trailer: files.trailer?.[0],
      video: files.video?.[0],
    }

    if (body.data) {
      Object.assign(data, JSON.parse(body.data))
    } else {
      // Also support ordinary JSON updates (for example taxonomy-only edits).
      // Multipart requests continue to send their JSON payload in body.data.
      Object.assign(data, body)
    }

    validate(editVideoSchema, data)

    const updatedVid = await AdminUploadService.editVideo({
      data,
      videoId: params.id,
      adminId: GetDefined.loggedInUser(user).id,
    })

    sendResponse({
      res,
      data: updatedVid,
    })
  })

  static fetchVideos = Catch.async(async ({ query, params }, res) => {
    const type = this._validateVideoType(params.type)

    sendResponse({
      res,
      message: `${type}s fetched successfully`,
      data: await AdminUploadService.getVideos(type, query),
    })
  })

  static fetchSeasonsAndEpisodes = Catch.async(async ({ query, params, user }, res) => {
    const currentUser = GetDefined.loggedInUser(user)
    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'superadmin'
    const seasons = await AdminUploadService.getSeasonsAndEpisodes(
      params.vidId,
      query,
      isAdmin,
    )

    if (!isAdmin) {
      const video = await VideoModel.findById(params.vidId).select('vidClass')
      if (video == null) throw new OperationalError('invalid video id', 404)

      await Promise.all(seasons.map(async season => {
        let canPlaySeason = video.vidClass === 'free'
        let accessEndsAt: Date | null = null
        if (!canPlaySeason && !isGuestUser(currentUser)) {
          const access = await PaymentService.checkHasValidContentPayment({
            currentUserId: currentUser._id,
            contentId: season._id.toString(),
            contentType: 'season',
          })
          canPlaySeason = access.canView
          accessEndsAt = 'accessEndsAt' in access ? access.accessEndsAt ?? null : null
        }
        Object.assign(season, { canView: canPlaySeason, accessEndsAt })
        if (!canPlaySeason) {
          season.episodes.forEach(episode => {
            const lockedEpisode = episode as typeof episode & { video?: string }
            delete lockedEpisode.video
          })
        }
      }))
    }

    sendResponse({
      res,
      message: `seasons fetched successfully`,
      data: seasons,
    })
  })

  static fetchProcessingStatus = Catch.async(async ({ query, params }, res) => {
    sendResponse({
      res,
      data: await AdminUploadService.getContentProcessingStatus(
        params.id,
        query.live !== 'false',
      ),
    })
  })

  static deleteVideo = Catch.async(async ({ params }, res) => {
    const type = this._validateVideoType(params.type)

    await AdminUploadService.deleteVideo(params.id, type)

    sendResponse({
      res,
      message: `${type} deleted successfully`,
    })
  })

  static checkVideoUploadTranscodedStatus = Catch.async(async ({ params }, res) => {
    const uploadStatus = await AdminUploadService.checkIsTranscoded(params.id)

    sendResponse({
      res,
      data: uploadStatus,
    })
  })
}
