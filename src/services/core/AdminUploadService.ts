import { Video, VideoModel, videoTypes } from '../../models/videos.model'
import { OperationalError } from '../../utils/OperationalError'
import { isYouTubeUrl } from '../../utils/youtube'
import { MaybeSession, withMongoDBSession } from '../../utils/mongoDbSessionRunner'

import {
  AddEpisodeUtilAggrRes,
  AddSeasonUtilAggrRes,
  FetchVideosParams,
  toObjectId,
  VideoRepo,
} from '../../repositories/VideoRepo'

import { MovieMediaSourcesUtils } from '../../utils/MovieMediaSourcesUtils'

import {
  guranteeNumericResult,
  QueryParamsFeatures,
  QueryParamsFeaturesOptions,
} from '../../utils/QueryParamsFeatures'

import { Purge } from '../../utils/Purge'
import { SeasonModel } from '../../models/seasons.model'
import { PipelineStage } from 'mongoose'
import { MediaManagement, UploadAndTranscodeConfig } from '../media-management'
import { EpisodeModel } from '../../models/episodes.model'
import { MulterFile, StringOrObjectId } from '../../types'
import { validate } from '../../middlewares/requestValidator'
import { videoUploadParents } from '../../models/assets'
import { addSeriesSchema, addMovieOrSkitSchema, addMusicVideoSchema } from '../../validations/admin'
import { UploadMediaUtils } from '../../utils/UploadMediaUtils'
import { VideoUploadModel } from '../../models/videoupload.model'
import { CronTaskHandlers } from '../../cron/CronTaskHandlers'
import { ContentLifecycleNotificationService } from './ContentLifecycleNotificationService'
import { MediaConvert } from '../aws/mediaConvert'
import { MultipartUploadService } from './MultipartUploadService'

export class AdminUploadService {
  static resolveWithMediaSources = (queryParams: QueryParamsFeaturesOptions['queryParams']) =>
    queryParams.withMediaSources === 'true'

  protected static _validateAddMovieData = (type: AllVideoTypes, data: MovieData, files: any) => {
    if (type === 'series') {
      validate(addSeriesSchema, data)
      return
    }

    Object.assign(data, {
      ...data,
      video: files.video?.[0],
    })

    switch (type) {
      case 'movie':
        validate(addMovieOrSkitSchema, data)
        break

      case 'skit':
        validate(addMovieOrSkitSchema, data)
        break

      case 'music-video':
        validate(addMusicVideoSchema, data)
        break

      default:
        throw new OperationalError(`Valid movie types are ${videoTypes.join(' || ')} `, 400)
    }
  }

  protected static _uploadVideoPosters = async (
    portraitFile: MulterFile,
    landscapeFile: MulterFile,
    expire?: Date,
  ) => {
    const [portraitUpload, landscapeUpload] = await Promise.all([
      MediaManagement.storeImageAndSubtitle(portraitFile, expire, 'portrait-poster'),
      MediaManagement.storeImageAndSubtitle(landscapeFile, expire, 'landscape-poster'),
    ])

    return {
      portraitUpload,
      landscapeUpload,
    }
  }

  static _validateAddVideoFileTypes = (data: AddVideoParams['data'] | EditVideoParams['data']) => {
    data.portraitPoster &&
      UploadMediaUtils.allowMimetype(
        data.portraitPoster,
        'image',
        'portraitPoster must be an image',
      )

    data.landscapePoster &&
      UploadMediaUtils.allowMimetype(
        data.landscapePoster,
        'image',
        'landscapePoster must be an image',
      )

    data.trailer &&
      UploadMediaUtils.allowMimetype(data.trailer, 'video', ' trailer must be a video file')

    data.video && UploadMediaUtils.allowMimetype(data.video, 'video', 'video must be a video file')
  }

  static _validateWithMovieAndPrevSeasonsAggrResult = (
    aggregateResponse: (undefined | AddSeasonUtilAggrRes)[],
  ) => {
    const result = aggregateResponse[0]

    if (result == null) {
      throw new OperationalError('invalid videoId', 404)
    }

    if (!result.isMovieSeries) {
      throw new OperationalError('movie is not a series', 403)
    }

    if (result.totalPreviousSeasons > 0 && result.totalEpisodesOfLastSeason === 0) {
      throw new OperationalError('Last Season must have at least one Episode', 403)
    }

    if (result.movieExpiryDate && new Date() > result.movieExpiryDate) {
      throw new OperationalError('Movie has expired', 403)
    }

    return result
  }

  static _validateWithSeasonAndPrevEpisodes = (aggrRes: AddEpisodeUtilAggrRes[]) => {
    if (aggrRes.length == 0) {
      throw new OperationalError('invalid season Id', 404)
    }
  }

  protected static _getVideoDocument = ({ data, type, adminId }: AddVideoParams) => {
    const videoDoc = new VideoModel({
      type,
      adminId: adminId,
      title: data.title,
      primaryColor: data.primaryColor,
      description: data.description,
      vidClass: data.vidClass,
      isReeplayOriginal: data.vidClass === 'premium' && Boolean(data.isReeplayOriginal),
      artistName: data.artistName,
      pg: data.pg,
      genre: data.genre ?? [],
      category: data.category ?? [],
      cast: data.cast ?? [],
      defaultRating: data.defaultRating ? +data.defaultRating : undefined,
      releaseDate: data.releasedDate,
      expiryDate: data.expiryDate,
      videoLink: data.videoLink,
      trailerLink: data.trailerLink,
      runtime: data.runtime,
      active: data.active,
      showViews: data.showViews,
    })

    return videoDoc
  }

  protected static _checkCanUploadVideo = (incomingData: AddVideoParams['data']) => {
    this._validateAddVideoFileTypes(incomingData)

    if (incomingData.vidClass !== 'free' && isYouTubeUrl(incomingData.videoLink)) {
      throw new OperationalError(
        'YouTube links can only be used as trailers or as the main video for free content',
        400,
      )
    }
  }

  static _uploadVideoSession = async (params: AddVideoParams, session: MaybeSession) => {
    this._checkCanUploadVideo(params.data)
    const videoDocument = this._getVideoDocument(params)
    const expiry = videoDocument.expiryDate ?? undefined

    const posterUploads = await this._uploadVideoPosters(
      params.data.portraitPoster,
      params.data.landscapePoster,
      expiry,
    )

    videoDocument.landscapePhoto = {
      Bucket: posterUploads.landscapeUpload.Bucket,
      Key: posterUploads.landscapeUpload.Key,
    }

    videoDocument.portraitPhoto = {
      Bucket: posterUploads.portraitUpload.Bucket,
      Key: posterUploads.portraitUpload.Key,
    }

    if (params.data.trailer || params.data.trailerUploadId) {
      const tVideoUploadDocument = params.data.trailerUploadId
        ? await MultipartUploadService.claim({
            videoUploadId: params.data.trailerUploadId,
            adminId: params.adminId,
            mediaKind: 'trailer', target: 'vod', parentId: videoDocument._id,
            parentType: 'vod-trailer', session,
          })
        : UploadMediaUtils.getVideoUploadDocument(
            await MediaManagement.upload720pAndInitiateMediaConvert(params.data.trailer!, expiry),
          )
      if (!params.data.trailerUploadId) {
        tVideoUploadDocument.parentId = videoDocument._id
        tVideoUploadDocument.parentType = 'vod-trailer'
        await tVideoUploadDocument.save({ session })
      }
      videoDocument.isTrailerReady = false
      videoDocument.trailerUpload = tVideoUploadDocument._id
    }

    if (params.data.video || params.data.videoUploadId) {
      const videoUploploadDocument = params.data.videoUploadId
        ? await MultipartUploadService.claim({
            videoUploadId: params.data.videoUploadId,
            adminId: params.adminId,
            mediaKind: 'main', target: 'vod', parentId: videoDocument._id,
            parentType: 'vod', session,
          })
        : UploadMediaUtils.getVideoUploadDocument(
            await MediaManagement.uploadAndInitiateMediaConvert(params.data.video!, expiry),
          )
      if (!params.data.videoUploadId) {
        videoUploploadDocument.parentId = videoDocument._id
        videoUploploadDocument.parentType = 'vod'
        await videoUploploadDocument.save({ session })
      }
      videoDocument.isVideoReady = false
      videoDocument.videoUpload = videoUploploadDocument._id
    }

    await videoDocument.save({ session })
    return videoDocument
  }

  static addVideo = async (input: AddVideoParams) => {
    const video = await withMongoDBSession(this._uploadVideoSession, input)
    const releaseDate = video.releaseDate ? new Date(video.releaseDate) : null
    const isUpcoming = Boolean(releaseDate && releaseDate.getTime() > Date.now())

    if (isUpcoming) {
      await ContentLifecycleNotificationService.publish({
        eventKey: `vod:${video._id}:upcoming`,
        title: 'New upcoming title',
        description: `${video.title} is coming to Reeplay`,
        category: 'upcoming_events',
        route: '/upcoming',
        type: 'UPCOMING_CONTENT',
        audience: 'upcoming_events',
        metadata: { contentId: video._id.toString(), contentType: 'vod' },
        photo: video.landscapePhoto,
      })
    } else if (video.videoLink) {
      await ContentLifecycleNotificationService.publish({
        eventKey: `vod:${video._id}:new-arrival`,
        title: 'New arrival',
        description: `${video.title} is now available`,
        category: 'new_arrivals',
        route: '/uploads',
        type: 'NEW_ARRIVAL',
        audience: 'new_arrivals',
        metadata: { contentId: video._id.toString(), contentType: 'vod' },
        photo: video.landscapePhoto,
      })
    }

    return video
  }

  static addSeason = async ({ videoId, adminId, description }: AddSeasonParams) => {
    const aggrRes = this._validateWithMovieAndPrevSeasonsAggrResult(
      await VideoRepo.addSeasonUtilAggr(videoId),
    )

    return await SeasonModel.create({
      description,
      admin: adminId,
      video: videoId,
      serial_number: aggrRes.totalPreviousSeasons + 1,
    })
  }

  static canAddSeason = async (videoId: string) => {
    const aggrRes = await VideoRepo.addSeasonUtilAggr(videoId)
    this._validateWithMovieAndPrevSeasonsAggrResult(aggrRes)
  }

  static canAddEpisode = async (seasonId: string) => {
    const aggrUtilsRes = await VideoRepo.addEpisodeUtilAggr(seasonId)
    this._validateWithSeasonAndPrevEpisodes(aggrUtilsRes)
  }

  static addEpisode = async (input: AddEpisodeInput) =>
    await withMongoDBSession(this._addEpisodesWithSession, input)

  static editEpisode = async (input: EditEpisodeInput) => {
    const { episode, replacedUploads } = await withMongoDBSession(
      this._editEpisodeWithSession,
      input,
    )

    await Promise.allSettled(
      replacedUploads.map(uploadId => Purge.videoUploadById(uploadId as any)),
    )
    return episode
  }

  static _editEpisodeWithSession = async (
    { episodeId, data, adminId }: EditEpisodeInput,
    session: MaybeSession,
  ) => {
    data.trailer &&
      UploadMediaUtils.allowMimetype(data.trailer, 'video', 'trailer must be a video file')
    data.video && UploadMediaUtils.allowMimetype(data.video, 'video', 'video must be a video file')

    const episode = await EpisodeModel.findById(episodeId).session(session ?? null)
    if (episode == null) throw new OperationalError('invalid episode id', 404)

    const replacedUploads: StringOrObjectId[] = []
    episode.admin = adminId as any
    if (data.title !== undefined) episode.title = data.title
    if (data.description !== undefined) episode.description = data.description

    if (data.video || data.videoUploadId || data.videoLink) {
      if (episode.videoUpload) replacedUploads.push(episode.videoUpload)

      if (data.video || data.videoUploadId) {
        const uploadDocument = data.videoUploadId
          ? await MultipartUploadService.claim({
              videoUploadId: data.videoUploadId, adminId, mediaKind: 'main', target: 'episode',
              parentId: episode._id, parentType: 'episode', session,
            })
          : UploadMediaUtils.getVideoUploadDocument(
              await MediaManagement.uploadAndInitiateMediaConvert(data.video!),
            )
        if (!data.videoUploadId) {
          uploadDocument.parentId = episode._id
          uploadDocument.parentType = 'episode'
          await uploadDocument.save({ session })
        }

        episode.videoUpload = uploadDocument._id
        episode.videoLink = undefined
        episode.isVideoReady = false
      } else {
        episode.videoUpload = undefined
        episode.videoLink = data.videoLink
        episode.isVideoReady = true
      }
    }

    if (data.trailer || data.trailerUploadId || data.trailerLink) {
      if (episode.trailerUpload) replacedUploads.push(episode.trailerUpload)

      if (data.trailer || data.trailerUploadId) {
        const uploadDocument = data.trailerUploadId
          ? await MultipartUploadService.claim({
              videoUploadId: data.trailerUploadId, adminId, mediaKind: 'trailer', target: 'episode',
              parentId: episode._id, parentType: 'episode-trailer', session,
            })
          : UploadMediaUtils.getVideoUploadDocument(
              await MediaManagement.upload720pAndInitiateMediaConvert(data.trailer!),
            )
        if (!data.trailerUploadId) {
          uploadDocument.parentId = episode._id
          uploadDocument.parentType = 'episode-trailer'
          await uploadDocument.save({ session })
        }

        episode.trailerUpload = uploadDocument._id
        episode.trailerLink = undefined
        episode.isTrailerReady = false
      } else {
        episode.trailerUpload = undefined
        episode.trailerLink = data.trailerLink
        episode.isTrailerReady = true
      }
    }

    await episode.save({ session })
    return { episode, replacedUploads }
  }

  static deleteEpisode = async (episodeId: string) => {
    const episode = await EpisodeModel.findByIdAndDelete(episodeId)
    if (episode == null) throw new OperationalError('invalid episode id', 404)

    const followingEpisodes = await EpisodeModel.find({
      season: episode.season,
      episodeNumber: { $gt: episode.episodeNumber },
    }).sort({ episodeNumber: 1 })

    // Renumber in ascending order so the unique season/episode index can never
    // collide while the gap left by the deleted episode is being closed.
    for (const followingEpisode of followingEpisodes) {
      followingEpisode.episodeNumber -= 1
      await followingEpisode.save()
    }

    await Promise.allSettled([
      Purge.subtitlesByParentId(episode._id),
      episode.videoUpload ? Purge.videoUploadById(episode.videoUpload) : Promise.resolve(),
      episode.trailerUpload ? Purge.videoUploadById(episode.trailerUpload) : Promise.resolve(),
    ])
  }

  static deleteSeason = async (seasonId: string) => {
    const season = await SeasonModel.findById(seasonId)
    if (season == null) throw new OperationalError('invalid season id', 404)

    if ((await EpisodeModel.exists({ season: seasonId })) != null) {
      throw new OperationalError('Delete every episode in this season first', 409)
    }

    await season.deleteOne()
  }

  static _addEpisodesWithSession = async (
    { seasonId, data, adminId }: AddEpisodeInput,
    session: MaybeSession,
  ) => {
    data.subTitle &&
      UploadMediaUtils.allowMimetype(data.subTitle, 'text', 'subTitle must be a text file')
    data.trailer &&
      UploadMediaUtils.allowMimetype(data.trailer, 'video', ' trailer must be a video file')
    data.video && UploadMediaUtils.allowMimetype(data.video, 'video', 'video must be a video file')

    const aggrUtilsRes = await VideoRepo.addEpisodeUtilAggr(seasonId)
    this._validateWithSeasonAndPrevEpisodes(aggrUtilsRes)

    const episodeDocument = new EpisodeModel({
      title: data.title,
      description: data.description,
      episodeNumber: aggrUtilsRes[0].totalPreviousEpisodes + 1,
      trailerLink: data.trailerLink,
      videoLink: data.videoLink,
      season: seasonId,
      admin: adminId,
    })

    if (data.trailer || data.trailerUploadId) {
      const videoUploadDocument = data.trailerUploadId
        ? await MultipartUploadService.claim({
            videoUploadId: data.trailerUploadId, adminId, mediaKind: 'trailer', target: 'episode',
            parentId: episodeDocument._id, parentType: 'episode-trailer', session,
          })
        : UploadMediaUtils.getVideoUploadDocument(
            await MediaManagement.upload720pAndInitiateMediaConvert(data.trailer!),
          )
      if (!data.trailerUploadId) {
        videoUploadDocument.parentId = episodeDocument._id
        videoUploadDocument.parentType = 'episode-trailer'
        await videoUploadDocument.save({ session })
      }
      episodeDocument.trailerUpload = videoUploadDocument._id
      episodeDocument.isTrailerReady = false
    }

    if (data.video || data.videoUploadId) {
      const videoUploadDocument = data.videoUploadId
        ? await MultipartUploadService.claim({
            videoUploadId: data.videoUploadId, adminId, mediaKind: 'main', target: 'episode',
            parentId: episodeDocument._id, parentType: 'episode', session,
          })
        : UploadMediaUtils.getVideoUploadDocument(
            await MediaManagement.uploadAndInitiateMediaConvert(data.video!),
          )
      if (!data.videoUploadId) {
        videoUploadDocument.parentId = episodeDocument._id
        videoUploadDocument.parentType = 'episode'
        await videoUploadDocument.save({ session })
      }
      episodeDocument.videoUpload = videoUploadDocument._id
      episodeDocument.isVideoReady = false
    }

    // await this._uploadEpisodeVideos({ data, episode }, session)
    await episodeDocument.save({ session })
    return episodeDocument
  }

  static editVideo = async (input: EditVideoParams) => {
    const { video, replacedUploads } = await withMongoDBSession(this._editVideoSession, input)
    await Promise.allSettled(replacedUploads.map(uploadId => Purge.videoUploadById(uploadId)))
    return video
  }

  static _editVideoSession = async (
    { data, adminId, videoId }: EditVideoParams,
    session: MaybeSession,
  ) => {
    this._validateAddVideoFileTypes(data)
    const videoDocument = await VideoModel.findById(videoId)

    if (videoDocument == null) {
      throw new OperationalError('invalid video id', 404)
    }
    const replacedUploads: StringOrObjectId[] = []

    const nextVideoClass = data.vidClass ?? videoDocument.vidClass
    const nextVideoLink = data.videoLink ?? videoDocument.videoLink
    if (nextVideoClass !== 'free' && isYouTubeUrl(nextVideoLink)) {
      throw new OperationalError(
        'YouTube links can only be used as trailers or as the main video for free content',
        400,
      )
    }

    const previousPortraitPhoto = data.portraitPoster
      ? videoDocument.portraitPhoto && {
          Key: videoDocument.portraitPhoto.Key,
          Bucket: videoDocument.portraitPhoto.Bucket,
        }
      : undefined
    const previousLandscapePhoto = data.landscapePoster
      ? videoDocument.landscapePhoto && {
          Key: videoDocument.landscapePhoto.Key,
          Bucket: videoDocument.landscapePhoto.Bucket,
        }
      : undefined

    if (data.description !== undefined) videoDocument.description = data.description
    if (data.title !== undefined) videoDocument.title = data.title
    if (data.primaryColor !== undefined) videoDocument.primaryColor = data.primaryColor
    if (typeof data.upcoming === 'boolean') {
      videoDocument.upcoming = data.upcoming
    }
    videoDocument.adminId = toObjectId(adminId)
    if (data.vidClass !== undefined) videoDocument.vidClass = data.vidClass as any
    if (data.isReeplayOriginal !== undefined || data.vidClass === 'free') {
      videoDocument.isReeplayOriginal =
        videoDocument.vidClass === 'premium' && Boolean(data.isReeplayOriginal)
    }
    if (data.artistName !== undefined) videoDocument.artistName = data.artistName
    if (data.pg !== undefined) videoDocument.pg = data.pg

    const replaceReferences = (references: string[]) => [...new Set(references)].map(toObjectId)

    // Edit payloads represent the complete selected taxonomy. Replacing these
    // arrays is required so deselected values are actually removed in MongoDB.
    if (data.genre !== undefined) {
      videoDocument.genre = replaceReferences(data.genre)
    }

    if (data.category !== undefined) {
      videoDocument.category = replaceReferences(data.category)
    }

    if (data.cast !== undefined) {
      videoDocument.cast = replaceReferences(data.cast)
    }

    videoDocument.defaultRating = data.defaultRating
      ? Number(data.defaultRating)
      : videoDocument.defaultRating

    videoDocument.releaseDate = data.releasedDate
      ? new Date(data.releasedDate)
      : videoDocument.releaseDate

    videoDocument.expiryDate = data.expiryDate
      ? new Date(data.expiryDate)
      : videoDocument.expiryDate

    const expiry = videoDocument.expiryDate ?? undefined

    if (data.runtime !== undefined) videoDocument.runtime = data.runtime
    if (data.active !== undefined) videoDocument.active = data.active
    if (data.showViews !== undefined) videoDocument.showViews = data.showViews
    if (data.portraitPoster) {
      const potraitUpload = await MediaManagement.storeImageAndSubtitle(
        data.portraitPoster,
        expiry,
        'portrait-poster',
      )

      videoDocument.portraitPhoto = {
        Bucket: potraitUpload.Bucket,
        Key: potraitUpload.Key,
      }
      videoDocument.markModified('portraitPhoto')
    }

    if (data.landscapePoster) {
      const newLandscapePoster = await MediaManagement.storeImageAndSubtitle(
        data.landscapePoster,
        expiry,
        'landscape-poster',
      )

      videoDocument.landscapePhoto = {
        Bucket: newLandscapePoster.Bucket,
        Key: newLandscapePoster.Key,
      }
      videoDocument.markModified('landscapePhoto')
    }

    if (data.removeVideo) {
      if (videoDocument.videoUpload) {
        replacedUploads.push(videoDocument.videoUpload)
      }
      videoDocument.videoUpload = undefined
      videoDocument.videoLink = undefined
      videoDocument.isVideoReady = false
    } else if (data.video || data.videoUploadId) {
      if (videoDocument.videoUpload) {
        replacedUploads.push(videoDocument.videoUpload)
      }

      const videoUploadDocument = data.videoUploadId
        ? await MultipartUploadService.claim({
            videoUploadId: data.videoUploadId, adminId, mediaKind: 'main', target: 'vod',
            parentId: videoDocument._id, parentType: 'vod', session,
          })
        : UploadMediaUtils.getVideoUploadDocument(
            await MediaManagement.uploadAndInitiateMediaConvert(data.video!, expiry),
          )
      if (!data.videoUploadId) {
        videoUploadDocument.parentId = videoDocument._id
        videoUploadDocument.parentType = 'vod'
        await videoUploadDocument.save({ session })
      }
      videoDocument.videoUpload = videoUploadDocument._id
      videoDocument.videoLink = undefined
      videoDocument.isVideoReady = false
    } else if (data.videoLink !== undefined) {
      if (videoDocument.videoUpload) {
        replacedUploads.push(videoDocument.videoUpload)
      }
      videoDocument.videoUpload = undefined
      videoDocument.videoLink = data.videoLink
      videoDocument.isVideoReady = true
    }

    if (data.removeTrailer) {
      if (videoDocument.trailerUpload) {
        replacedUploads.push(videoDocument.trailerUpload)
      }
      videoDocument.trailerUpload = undefined
      videoDocument.trailerLink = undefined
      videoDocument.isTrailerReady = false
    } else if (data.trailer || data.trailerUploadId) {
      if (videoDocument.trailerUpload) {
        replacedUploads.push(videoDocument.trailerUpload)
      }

      const videoUploadDocument = data.trailerUploadId
        ? await MultipartUploadService.claim({
            videoUploadId: data.trailerUploadId, adminId, mediaKind: 'trailer', target: 'vod',
            parentId: videoDocument._id, parentType: 'vod-trailer', session,
          })
        : UploadMediaUtils.getVideoUploadDocument(
            await MediaManagement.upload720pAndInitiateMediaConvert(data.trailer!, expiry),
          )
      if (!data.trailerUploadId) {
        videoUploadDocument.parentId = videoDocument._id
        videoUploadDocument.parentType = 'vod-trailer'
        await videoUploadDocument.save({ session })
      }
      videoDocument.trailerUpload = videoUploadDocument._id
      videoDocument.trailerLink = undefined
      videoDocument.isTrailerReady = false
    } else if (data.trailerLink !== undefined) {
      if (videoDocument.trailerUpload) {
        replacedUploads.push(videoDocument.trailerUpload)
      }
      videoDocument.trailerUpload = undefined
      videoDocument.trailerLink = data.trailerLink
      videoDocument.isTrailerReady = true
    }

    await videoDocument.save({ session })

    if (previousPortraitPhoto) {
      void MediaManagement.deleteObject(previousPortraitPhoto.Key, previousPortraitPhoto.Bucket)
    }
    if (previousLandscapePhoto) {
      void MediaManagement.deleteObject(previousLandscapePhoto.Key, previousLandscapePhoto.Bucket)
    }

    return { video: videoDocument, replacedUploads }
  }

  static deleteVideo = async (vidId: string, type: AllVideoTypes) => {
    const deletedVidocument = await VideoModel.findOneAndDelete({ _id: vidId, type })

    if (deletedVidocument == null) {
      throw new OperationalError(`Not found or video is not a ${type} `, 404)
    }

    // do not await
    Purge.vod(deletedVidocument)
  }

  static getVideos = async (
    type: AllVideoTypes,
    query: QueryParamsFeaturesOptions['queryParams'],
  ) => {
    const { page, limit } = QueryParamsFeatures.paginagteParams(query)

    const queryParams: FetchVideosParams = {
      prevStages: [{ $match: { type } }],
      excludeExpired: false,
      excludePreReleased: false,
      // Admins must still be able to see and diagnose uploads while HLS
      // processing is pending or has failed. Customer queries remain ready-only.
      onlyReady: false,
      populateCasts: true,
      page,
      limit,
    }

    if (query.sortby === 'RECENT') {
      queryParams.sortStage = { $sort: { _id: -1 } }
    }

    const aggrgatedVideoDocuments = await VideoRepo.adminFetchByType(queryParams)
    const videos = MovieMediaSourcesUtils.resolveMediaSources(
      aggrgatedVideoDocuments,
      '720p',
    ) as unknown as Array<Record<string, any>>

    return await Promise.all(
      videos.map(async video => ({
        ...video,
        processing: await this.getContentProcessingStatus(video._id.toString(), false),
      })),
    )
  }

  static getSeasonsAndEpisodes = async (
    vidSeriesId: string,
    queryParams: any,
    includeProcessing = false,
  ) => {
    const { page, limit } = QueryParamsFeatures.paginagteParams(queryParams)

    const seasonsWithMediaSources = MovieMediaSourcesUtils.resolveSeasonsMediaSources(
      await VideoRepo.fetchSeasonsAndEpisodes(vidSeriesId, page, limit, includeProcessing),
      '720p',
    )

    return seasonsWithMediaSources
  }

  static checkIsTranscoded = async (videoUploadId: string) => {
    const videoUploadDocument = await VideoUploadModel.findById(videoUploadId)

    if (videoUploadDocument == null) {
      throw new OperationalError('Not found', 404)
    }

    if (!videoUploadDocument.isTranscoded) {
      // The admin polls this endpoint while processing. Reconcile the exact
      // upload immediately as a fallback to the background batch worker.
      await CronTaskHandlers.updateVideoUploadDoc(videoUploadDocument)
    }

    return {
      isReady: videoUploadDocument.isTranscoded,
      status: videoUploadDocument.hlsStatus,
      error: videoUploadDocument.hlsError,
    }
  }

  static getContentProcessingStatus = async (videoId: string, live = true) => {
    const video = await VideoModel.findById(videoId).select(
      'title type active releaseDate expiryDate isVideoReady isTrailerReady videoUpload trailerUpload videoLink trailerLink',
    )
    if (video == null) throw new OperationalError('Content not found', 404)

    const buildUploadStatus = async (
      uploadId: unknown,
      ready: boolean,
      kind: 'main' | 'trailer',
      label: string,
    ) => {
      if (!uploadId) {
        return {
          id: null,
          kind,
          label,
          status: ready ? ('ready' as const) : ('missing' as const),
          progress: ready ? 100 : 0,
          error: null,
        }
      }

      const upload = await VideoUploadModel.findById(uploadId)
      if (upload == null) {
        return {
          id: String(uploadId),
          kind,
          label,
          status: 'missing' as const,
          progress: 0,
          error: 'Upload record not found',
        }
      }

      if (live && !upload.isTranscoded && upload.hlsStatus !== 'failed') {
        await CronTaskHandlers.updateVideoUploadDoc(upload)
      }

      let progress: number | null = upload.isTranscoded || upload.hlsStatus === 'ready' ? 100 : 0
      let providerStatus: string | null = null
      if (live && !upload.isTranscoded && upload.hlsJobId && upload.hlsStatus !== 'failed') {
        try {
          const job = await MediaConvert.getJob(upload.hlsJobId)
          providerStatus = job?.Status ?? null
          progress = job?.JobPercentComplete ?? null
        } catch (error: any) {
          // Progress is diagnostic information. A transient AWS status failure
          // must not hide the persisted processing state from the admin.
          providerStatus = null
        }
      }

      return {
        id: upload._id.toString(),
        kind,
        label,
        status: upload.isTranscoded ? ('ready' as const) : upload.hlsStatus,
        progress,
        providerStatus,
        error: upload.hlsError ?? null,
        updatedAt: upload.updatedAt,
      }
    }

    let items: Awaited<ReturnType<typeof buildUploadStatus>>[] = []
    if (video.type === 'series') {
      const seasons = await SeasonModel.find({ video: video._id }).select('_id serial_number')
      const seasonNumbers = new Map(
        seasons.map(season => [season._id.toString(), season.serial_number]),
      )
      const episodes = await EpisodeModel.find({
        season: { $in: seasons.map(season => season._id) },
      })
        .select('season episodeNumber title isVideoReady isTrailerReady videoUpload trailerUpload')
        .sort({ season: 1, episodeNumber: 1 })

      const episodeItems = await Promise.all(
        episodes.flatMap(episode => {
          const prefix = `S${seasonNumbers.get(episode.season.toString()) ?? '?'} E${episode.episodeNumber}`
          const statuses = [
            buildUploadStatus(
              episode.videoUpload,
              Boolean(episode.isVideoReady),
              'main',
              `${prefix} · ${episode.title}`,
            ),
          ]
          if (episode.trailerUpload || episode.isTrailerReady) {
            statuses.push(
              buildUploadStatus(
                episode.trailerUpload,
                Boolean(episode.isTrailerReady),
                'trailer',
                `${prefix} trailer`,
              ),
            )
          }
          return statuses
        }),
      )
      items = episodeItems
    } else {
      items = await Promise.all([
        buildUploadStatus(video.videoUpload, Boolean(video.isVideoReady), 'main', 'Main content'),
        buildUploadStatus(video.trailerUpload, Boolean(video.isTrailerReady), 'trailer', 'Trailer'),
      ])
    }

    const mainItems = items.filter(item => item.kind === 'main')
    const hasProcessing = items.some(
      item => item.status === 'pending' || item.status === 'processing',
    )
    const hasFailure = items.some(item => item.status === 'failed' || item.status === 'missing')
    const mediaReady =
      video.type === 'series'
        ? mainItems.some(item => item.status === 'ready')
        : mainItems.every(item => item.status === 'ready') &&
          items.filter(item => item.kind === 'trailer').every(item => item.status === 'ready')
    const now = new Date()
    const released = !video.releaseDate || video.releaseDate <= now
    const unexpired = !video.expiryDate || video.expiryDate > now
    const published = Boolean(video.active && released && unexpired && mediaReady)
    const state = hasProcessing
      ? 'processing'
      : hasFailure
        ? 'failed'
        : mediaReady
          ? 'ready'
          : 'draft'

    return {
      contentId: video._id.toString(),
      title: video.title,
      type: video.type,
      state,
      mediaReady,
      published,
      publicationReason: published
        ? 'Published in the app'
        : !mediaReady
          ? 'Waiting for required media'
          : !video.active
            ? 'Content is inactive'
            : !released
              ? 'Scheduled for release'
              : !unexpired
                ? 'Content has expired'
                : 'Not published',
      items,
    }
  }
}

export type AddEpisodeInput = {
  seasonId: string
  data: EpisodeReqData
  adminId: string
}

export type EditEpisodeInput = Omit<AddEpisodeInput, 'seasonId' | 'data'> & {
  episodeId: string
  data: Partial<EpisodeReqData>
}

type EpisodeReqData = {
  title: string
  description?: string
  videoLink?: string
  trailerLink?: string
  subTitleLanguage?: string
  subTitle?: MulterFile
  video?: MulterFile
  trailer?: MulterFile
  videoUploadId?: string
  trailerUploadId?: string
}

export type AllVideoTypes = Video['type']

export type MovieData = {
  title: string
  pg: string
  description: string
  vidClass: Video['vidClass']
  primaryColor: string

  defaultRating?: string
  videoLink?: string
  trailerLink?: string
  runtime?: string
  expiryDate?: string
  releasedDate: string
  artistName?: string

  isReeplayOriginal?: boolean

  active?: boolean
  showViews?: boolean

  category?: string[]
  genre?: string[]
  cast?: string[]

  //files
  landscapePoster: MulterFile
  portraitPoster: MulterFile
  trailer?: MulterFile
  video?: MulterFile
  trailerUploadId?: string
  videoUploadId?: string
  removeTrailer?: boolean
  removeVideo?: boolean
}

export type AddSeasonParams = {
  adminId: string
  videoId: string
  description?: string
}

export type AddVideoParams = {
  data: MovieData
  type: AllVideoTypes
  adminId: string
}

export type EditVideoParams = Pick<AddVideoParams, 'adminId'> & {
  data: Partial<MovieData> & { upcoming?: boolean }
  videoId: string
}

export type GetVideoUploadDoc = UploadAndTranscodeConfig & {
  parentType: (typeof videoUploadParents)[number]
  parentId: StringOrObjectId
}
