import { Response, Request } from 'express'
import { MediaService } from '../../services/core/MediaService'
import { Catch } from '../../utils/Catch'
import { GetDefined } from '../../utils/GetDefined'
import { OperationalError } from '../../utils/OperationalError'
import { sendResponse } from '../../utils/responder'
import { validate } from '../../middlewares/requestValidator'
import { addLiveSchema } from '../../validations/admin'
import { UploadMediaUtils } from '../../utils/UploadMediaUtils'
import { AuthHeaderKey } from '../../middlewares/auth'
import { LiveStreamService, CreateLiveData } from '../../services/core/LiveStreamService'
import { VideoService } from '../../services/core/VideoService'
import { PaymentService } from '../../services/core/PaymentService'
import { FilterQuery } from 'mongoose'
import env from '../../env'
import { LiveSchema, LiveModel } from '../../models/lives.model'
import { VideoModel } from '../../models/videos.model'
import { LiveRepo } from '../../repositories/LiveRepo'
import { VideoRepo, VodCardResponse } from '../../repositories/VideoRepo'
import { LiveAggrRes } from '../../types/Live'
import { denyGuestUser } from '../../utils/denyGuestUser'
import { LiveMediaSourcesUtils } from '../../utils/LiveMediaSourcesUtils'
import { MovieMediaSourcesUtils } from '../../utils/MovieMediaSourcesUtils'
import { QueryParamsFeatures, guranteeNumericResult } from '../../utils/QueryParamsFeatures'
import { VideoQuality, VidUploadUtils } from '../../utils/VideoUploadUtils'
import { getPromiseAllFulfilledResults } from '../../utils/promises'
import { VideoUploadRepo } from '../../repositories/VideoUploadRepo'
import { LikeModel } from '../../models/likes.model'
import {
  assertGuestCanView,
  filterGuestLives,
  filterGuestVods,
  isGuestUser,
} from '../../utils/guestAccess'
import { ViewService } from '../../services/core/ViewService'
import { AutoFeaturedService } from '../../services/core/AutoFeaturedService'
import { isYouTubeUrl } from '../../utils/youtube'
import { PersonalizedContentService } from '../../services/core/PersonalizedContentService'
import { VideoUploadModel } from '../../models/videoupload.model'
import { EpisodeModel } from '../../models/episodes.model'
import { SeasonModel } from '../../models/seasons.model'
import { MediaAccess } from '../../services/media-access'
import {TopTenService} from '../../services/core/TopTenService'

export type PaymentHistoryCaller = {
  caller: 'Admin' | 'Others'
}

type LiveEventsType =
  | 'all'
  | 'featured'
  | 'sponsored'
  | 'channels'
  | 'channels popular'
  | 'events'
  | 'events popular'
  | 'tvshows popular'
  | 'tvshows'
  | 'sports'
  | 'sports popular'
  | 'podcasts'
  | 'podcasts popular'

const interleaveSuggestions = <T, U>(primary: T[], secondary: U[]): Array<T | U> => {
  const suggestions: Array<T | U> = []
  const maxLength = Math.max(primary.length, secondary.length)

  for (let index = 0; index < maxLength; index += 1) {
    if (primary[index] !== undefined) suggestions.push(primary[index])
    if (secondary[index] !== undefined) suggestions.push(secondary[index])
  }

  return suggestions
}

export class SharedController extends UploadMediaUtils {
  static getPersonalizedVods = Catch.async(async ({ query, user }, res) => {
    const currentUser = GetDefined.loggedInUser(user)
    const { page, limit } = QueryParamsFeatures.paginagteParams(query)
    const splitIds = (value: unknown) =>
      typeof value === 'string' ? value.split(',').filter(Boolean).slice(0, 7) : []
    const vods = await PersonalizedContentService.getRecommendations(
      currentUser,
      {
        genreIds: splitIds(query.genreIds),
        categoryIds: splitIds(query.categoryIds),
      },
      page,
      limit,
    )

    sendResponse({
      res,
      data: MovieMediaSourcesUtils.resolveMediaSources(
        filterGuestVods(vods, currentUser),
        currentUser.videoQuality,
      ),
      message: 'personalized contents fetched successfully',
    })
  })

  static getVodDetailsById = Catch.async(async ({ params, user }, res) => {
    const currentUser = GetDefined.loggedInUser(user)
    const videos = filterGuestVods(await VideoRepo.fetchById(params.vodId), currentUser)
    const [video] = MovieMediaSourcesUtils.resolveMediaSources(videos, currentUser.videoQuality)

    if (video == null) {
      throw new OperationalError('VOD not found', 404)
    }

    sendResponse({ res, data: video })
  })

  static getVodMetaBy = Catch.async(async (req, res) => {
    const videoDocument = await VideoModel.findById(req.params.vodId).select(
      'averageRating viewsCount totalRatings commentsCount likesCount',
    )

    sendResponse({
      res,
      data: videoDocument,
    })
  })

  static getAllVods = Catch.async(async (req, res) => {
    const { page, limit } = QueryParamsFeatures.paginagteParams(req.query)
    const user = GetDefined.loggedInUser(req.user)
    const { videoQuality } = user
    const splitIds = (value: unknown) =>
      typeof value === 'string' ? value.split(',').filter(Boolean).slice(0, 7) : []
    const videoDocuments = await PersonalizedContentService.getRecommendations(
      user,
      {
        genreIds: splitIds(req.query.genreIds),
        categoryIds: splitIds(req.query.categoryIds),
      },
      page,
      limit,
    )

    sendResponse({
      res,
      data: MovieMediaSourcesUtils.resolveMediaSources(
        filterGuestVods(videoDocuments, user),
        videoQuality,
      ),
    })
  })

  static checkContentCosts = (_: Request, res: Response) => {
    const costs = PaymentService.checkContentCosts()

    sendResponse({
      res,
      data: costs,
    })
  }

  static checkHasPaidForContent = Catch.async(async (req, res) => {
    const result = await PaymentService.checkHasValidContentPayment({
      contentId: req.params.contentId,
      contentType: req.params.contentType,
      currentUserId: GetDefined.loggedInUser(req.user)._id,
    })

    sendResponse({
      res,
      data: result,
    })
  })

  static startPayment = Catch.async(async (req, res) => {
    const response = await PaymentService.initiatePayment({
      currentUser: GetDefined.loggedInUser(req.user),
      isMobile: req.useragent?.isMobile || false,
      ...req.body,
    })

    sendResponse({
      res,
      message: 'Payment initated successfully',
      data: response,
    })
  })

  static setPaymentShouldStoreDetails = Catch.async(async (req, res) => {
    const response = await PaymentService.setPaymentShouldStoreDetails(
      req.params.paymentId,
      req.query.shouldStore === 'true',
    )

    sendResponse({
      res,
      data: response,
    })
  })

  static authorizePayment = Catch.async(async (req, res) => {
    await PaymentService.authorizePayment({
      currentUser: GetDefined.loggedInUser(req.user),
      amount: req.body.amount,
      paymentDetailsId: req.body.paymentDetailsId,
    })

    sendResponse({
      res,
      data: 'Payment is successful',
    })
  })

  static fetchPaymentDetails = Catch.async(async (req, res) => {
    const response = await PaymentService.fetchPaymentDetails(
      GetDefined.loggedInUser(req.user)._id.toString(),
      req.query,
    )

    sendResponse({
      res,
      data: response,
    })
  })

  static updateProfile = (authType: AuthHeaderKey) =>
    Catch.async(async (req, res) => {
      if (Object.values(req.body).length === 0 && req.file == null) {
        throw new OperationalError('Provide at least one property to update', 400)
      }

      Object.assign(req.body, req.params)

      await MediaService.updateUserProfile({
        imageFile: req.file,
        data: req.body,
        authType,
      })

      sendResponse({
        res,
        message: 'Update successfull',
      })
    })

  static updateLiveMedia = Catch.async(async (req, res) => {
    const files = UploadMediaUtils.checkFiles(req.files)

    await LiveStreamService.editLiveMedia({
      liveId: req.params.liveId,
      coverPhotoFile: files.coverPhoto?.[0],
      previewVideoFile: files.previewVideo?.[0],
    })

    sendResponse({
      res,
      message: 'update initiated.. See dashboard for live after update completion',
    })
  })

  static updateLiveActiveStatus = Catch.async(async (req, res) => {
    await LiveStreamService.updateLiveActiveState({
      liveId: req.params.liveId,
      active: req.body.active,
    })

    sendResponse({
      res,
      message: 'Update successfull',
    })
  })

  static createLive = ({ isAdmin }: { isAdmin: boolean }) =>
    Catch.async(async (req, res) => {
      const { data: _data } = req.body

      if (_data == null || typeof _data !== 'string') {
        throw new OperationalError(
          'formData.data is required and must be a JSON serialized string',
          400,
        )
      }

      const files = UploadMediaUtils.checkFiles(req.files)
      const parsedData = JSON.parse(_data)

      const data: CreateLiveData = {
        ...parsedData,
        previewVideo: files.previewVideo?.[0],
        coverPhoto: files.coverPhoto?.[0],
        clientId: isAdmin ? parsedData.clientId : GetDefined.loggedInUser(req.user).id,
        creatorType: isAdmin ? 'admin' : 'client',
      }

      validate(addLiveSchema, data)

      sendResponse({
        res,
        data: await LiveStreamService.createLive(data),
        message: `Live will be attached to ${isAdmin ? 'client' : 'your'} dashboard after processing`,
      })
    })

  static adminGetPhotoUrl = Catch.async(async (req, res) => {
    const { bucket, key } = req.body
    const image = await MediaService.getPhotoUrl(bucket, key)
    sendResponse({ res, data: image, message: 'image fetched' })
  })

  static adminGetSubtitleUrl = Catch.async(async (req, res) => {
    const { bucket, key } = req.body
    const subtitle = await MediaService.getSubtitleUrl(bucket, key)
    sendResponse({ res, data: subtitle, message: 'subtitle fetched' })
  })

  static getVidoeUploadStream = Catch.async(async (req, res) => {
    const _vodStream = await MediaService.getVodStream(
      req.params.vidUploadId,
      GetDefined.loggedInUser(req.user),
    )
    sendResponse({ res, data: _vodStream, message: 'stream fetched' })
  })

  static getSubtitles = Catch.async(async (req, res) => {
    sendResponse({
      res,
      data: await MediaService.getSubtitles(req.params.parentId, req.params.type),
    })
  })

  static deleteLiveById = Catch.async(async (req, res) => {
    sendResponse({
      res,
      data: await LiveStreamService.deleteLive({
        liveId: req.params.liveId,
        currentUser: GetDefined.loggedInUser(req.user),
      }),
    })
  })

  static paymentHistory = ({ caller }: PaymentHistoryCaller) =>
    Catch.async(async (req, res) => {
      const getQueryUserId = () => {
        const { userId } = req.query

        if (typeof userId !== 'string') {
          throw new OperationalError('query.userId is required', 400)
        }

        return userId
      }

      const userId =
        caller === 'Admin' ? getQueryUserId() : GetDefined.loggedInUser(req.user)._id.toString()

      sendResponse({
        res,
        data: await PaymentService.getHistory(userId, req.query),
      })
    })

  static fetchVidsForCategory = Catch.async(async ({ query, user, params }, res) => {
    const videos = await VideoService.getVodsForCategory({
      categoryId: params.catId,
      currentUser: GetDefined.loggedInUser(user),
      query,
    })

    sendResponse({
      res,
      message: 'videos fetched succesfully',
      data: filterGuestVods(videos, user),
    })
  })

  static fetchWallet = Catch.async(async (req, res) => {
    const wallet = await PaymentService.fetchWallet(GetDefined.loggedInUser(req.user))

    sendResponse({
      res,
      data: wallet,
      message: 'user wallet info',
    })
  })

  static fetchVideoSource = Catch.async(async (req, res) => {
    const user = GetDefined.loggedInUser(req.user)

    const [videoDocumentResult, videoQualityResult] = await Promise.allSettled([
      VideoModel.findById(req.params.videoId),
      isGuestUser(user)
        ? Promise.resolve<VideoQuality>('480p')
        : VidUploadUtils.getUserVideoQuality(user._id.toString()),
    ])

    if (videoDocumentResult.status === 'rejected') {
      throw videoDocumentResult.reason
    }

    const quality: VideoQuality =
      videoQualityResult.status === 'rejected' ? '480p' : videoQualityResult.value

    const videoDocument = videoDocumentResult.value
    let source: string | null = null

    if (videoDocument == null) {
      throw new OperationalError('Not Found', 404)
    }
    assertGuestCanView(user, videoDocument.vidClass)

    switch (req.params.type) {
      case 'vod':
        if (videoDocument.vidClass !== 'free' && isYouTubeUrl(videoDocument.videoLink)) {
          throw new OperationalError(
            'Paid content cannot use YouTube as its main playback source',
            422,
          )
        }

        if (videoDocument.vidClass !== 'free') {
          const access = await PaymentService.checkHasValidContentPayment({
            contentId: videoDocument._id.toString(),
            contentType: 'vod',
            currentUserId: user._id,
          })
          if (!access.canView) {
            throw new OperationalError(
              'Successful wallet payment required to watch this content',
              403,
            )
          }
        }

        const vodUploadDocument = await VideoUploadRepo.findByParentId(videoDocument._id).where(
          'parentType',
          'vod',
        )

        if (vodUploadDocument?.isTranscoded) {
          source = req.query.download === 'true'
            ? MediaAccess.getSignedVideoURL(vodUploadDocument.key)
            : VidUploadUtils.getResSourceUrl(vodUploadDocument, quality)
          break
        }

        if (videoDocument.videoLink) {
          source = videoDocument.videoLink
          break
        }

        if (vodUploadDocument == null || vodUploadDocument.isTranscoded === false) {
          throw new OperationalError('Not Found', 404)
        }
        break

      case 'trailer':
        const videoUploadDocument = await VideoUploadRepo.findByParentId(videoDocument._id).where(
          'parentType',
          'vod-trailer',
        )

        if (videoUploadDocument?.isTranscoded) {
          source = VidUploadUtils.getResSourceUrl(videoUploadDocument, quality)
          break
        }

        if (videoDocument.trailerLink) {
          source = videoDocument.trailerLink
          break
        }

        if (videoUploadDocument == null || videoUploadDocument.isTranscoded === false) {
          throw new OperationalError('Not Found', 404)
        }
        break

      default:
        throw new OperationalError('Expected type to be vod or trailer', 404)
    }

    if (source == null) {
      throw new OperationalError('Not Found', 422)
    }

    sendResponse({
      res,
      data: { source },
    })
  })

  static fetchTopTen = Catch.async(async ({user}, res) => {
    sendResponse({
      res,
      data: await TopTenService.getPublic(GetDefined.loggedInUser(user)),
      message: 'Top 10 fetched',
    })
  })

  static fetchDownloadSource = Catch.async(async (req, res) => {
    const user = GetDefined.loggedInUser(req.user)
    const upload = await VideoUploadModel.findById(req.params.videoUploadId)
    if (!upload || (upload.parentType !== 'vod' && upload.parentType !== 'episode')) {
      throw new OperationalError('Download source not found', 404)
    }

    let video = upload.parentType === 'vod'
      ? await VideoModel.findById(upload.parentId)
      : null

    if (upload.parentType === 'episode') {
      const episode = await EpisodeModel.findById(upload.parentId).select('season')
      const season = episode
        ? await SeasonModel.findById(episode.season).select('video')
        : null
      video = season ? await VideoModel.findById(season.video) : null
    }

    if (!video) throw new OperationalError('Download source not found', 404)
    assertGuestCanView(user, video.vidClass)

    if (video.vidClass !== 'free') {
      const access = await PaymentService.checkHasValidContentPayment({
        contentId: video._id.toString(),
        contentType: 'vod',
        currentUserId: user._id,
      })
      if (!access.canView) {
        throw new OperationalError('Successful wallet payment required to download this content', 403)
      }
    }

    sendResponse({
      res,
      data: { source: MediaAccess.getSignedVideoURL(upload.key) },
    })
  })

  static getFeaturedVods = Catch.async(async ({ query, user }, res) => {
    await AutoFeaturedService.refreshIfDue()
    const currentUser = GetDefined.loggedInUser(user)
    const { videoQuality } = currentUser
    const { page, limit } = QueryParamsFeatures.paginagteParams(query)

    const vods = await VideoRepo.fetchFeatured(page, limit)

    sendResponse({
      res,
      data: MovieMediaSourcesUtils.resolveMediaSources(
        filterGuestVods(vods, currentUser),
        videoQuality,
      ),
      message: 'featured contents fetched successful',
    })
  })

  static getSimilarByCastId = Catch.async(async ({ query, user, params }, res) => {
    const currentUser = GetDefined.loggedInUser(user)
    const { page, limit } = QueryParamsFeatures.paginagteParams(query)

    const vods = await VideoRepo.fetchSimilarByCastId({
      page,
      limit,
      castId: params.castId,
      vodToExcludeId: query.vodId,
    })

    sendResponse({
      res,
      data: MovieMediaSourcesUtils.resolveMediaSources(
        filterGuestVods(vods, currentUser),
        currentUser.videoQuality,
      ),
      message: '',
    })
  })

  static getSimilarByGenreId = Catch.async(async ({ query, user, params }, res) => {
    const currentUser = GetDefined.loggedInUser(user)
    const { videoQuality } = currentUser

    const { page, limit } = QueryParamsFeatures.paginagteParams(query)

    const vods = await VideoRepo.fetchSimilarByGenreId({
      page,
      limit,
      genreId: params.genreId,
      vodToExcludeId: query.vodId,
    })

    sendResponse({
      res,
      data: MovieMediaSourcesUtils.resolveMediaSources(
        filterGuestVods(vods, currentUser),
        videoQuality,
      ),
      message: '',
    })
  })

  static getRelatedVods = Catch.async(async ({ query, user, params }, res) => {
    const currentUser = GetDefined.loggedInUser(user)
    const { page, limit } = QueryParamsFeatures.paginagteParams(query)
    const vods = await VideoRepo.fetchRelated({
      vodId: params.vodId,
      page,
      limit: Math.min(limit, 30),
    })

    if (vods === null) {
      throw new OperationalError('VOD not found', 404)
    }

    sendResponse({
      res,
      data: MovieMediaSourcesUtils.resolveMediaSources(
        filterGuestVods(vods, currentUser),
        currentUser.videoQuality,
      ),
      message: 'related contents fetched successfully',
    })
  })

  static getByCategoryIdAndAndGenreId = Catch.async(async ({ query, user, params }, res) => {
    const { page, limit } = QueryParamsFeatures.paginagteParams(query)

    const currentUser = GetDefined.loggedInUser(user)
    const { videoQuality } = currentUser

    const vods = await VideoRepo.fetchByCategAndCast({
      page,
      limit,
      genreId: params.genreId,
      catId: params.catId,
    })

    sendResponse({
      res,
      data: MovieMediaSourcesUtils.resolveMediaSources(
        filterGuestVods(vods, currentUser),
        videoQuality,
      ),
      message: '',
    })
  })

  static randomSuggestions = Catch.async(async ({ query, user }, res) => {
    const currentUser = GetDefined.loggedInUser(user)
    const { videoQuality } = currentUser
    const requestedLimit = QueryParamsFeatures.paginagteParams(query).limit
    const limit = Math.min(Math.max(requestedLimit, 1), 20)
    const guest = isGuestUser(currentUser)

    const [personalizedVods, liveCandidates] = await Promise.all([
      PersonalizedContentService.getRecommendations(
        currentUser,
        {},
        1,
        guest ? 100 : limit,
      ),
      LiveRepo.getMostEngaged(1, limit, {
        $match: guest ? { active: true, vid_class: 'free' } : { active: true },
      }),
    ])

    let vodCandidates = personalizedVods
      .filter(vod => !guest || vod.vidClass === 'free')
      .slice(0, limit)

    // A small catalogue or a new account may not yield enough personalized
    // results. Random discovery is deliberately used only as a fallback.
    if (vodCandidates.length < limit) {
      const fallbackVods = (await VideoRepo.fetchRandom(limit * 2)).filter(
        vod => !guest || vod.vidClass === 'free',
      )
      const seen = new Set(vodCandidates.map(vod => vod._id.toString()))

      vodCandidates = [
        ...vodCandidates,
        ...fallbackVods.filter(vod => {
          const id = vod._id.toString()
          if (seen.has(id)) return false
          seen.add(id)
          return true
        }),
      ].slice(0, limit)
    }

    const vods = MovieMediaSourcesUtils.resolveMediaSources(
      filterGuestVods(vodCandidates, currentUser),
      videoQuality,
    )
    const lives = await LiveMediaSourcesUtils.resolveSources(
      filterGuestLives(liveCandidates, currentUser),
      videoQuality,
    )

    const response = {
      vods,
      lives,
      items: interleaveSuggestions(vods, lives),
    }

    sendResponse({
      res,
      data: response,
      message: 'suggestions fetched successfully',
    })
  })

  static getFeaturedLives = Catch.async(async ({ query, user }, res) => {
    await AutoFeaturedService.refreshIfDue()
    const currentUser = GetDefined.loggedInUser(user)
    const vidQuality = isGuestUser(currentUser)
      ? '480p'
      : await VidUploadUtils.getUserVideoQuality(currentUser._id.toString())

    sendResponse({
      res,
      message: 'featured contents fetched successful',
      data: await LiveMediaSourcesUtils.resolveSources(
        filterGuestLives(
          await LiveRepo.getFeatured(
            guranteeNumericResult(query.page, 1),
            guranteeNumericResult(query.limit, 10),
          ),
          currentUser,
        ),
        vidQuality,
      ),
    })
  })

  // ***************** likes ************************ //

  static likeVideo = Catch.async(async (req, res) => {
    const user = GetDefined.loggedInUser(req.user)
    denyGuestUser(user)

    const videoDocument = await VideoModel.findById(req.params.id)

    if (videoDocument == null) {
      throw new OperationalError('Video Not found', 404)
    }

    await LikeModel.create({
      user: user._id,
      content: videoDocument._id,
      contentType: 'vod',
    })

    await VideoRepo.computeEngagements({
      session: undefined,
      property: 'likesCount',
      by: 1,
      id: videoDocument._id,
    })

    sendResponse({
      res,
      message: 'video liked',
    })
  })

  static viewContent = Catch.async(async (req, res) => {
    const user = GetDefined.loggedInUser(req.user)
    denyGuestUser(user)
    const result = await ViewService.registerUniqueView({
      viewer: user._id,
      content: req.body.content,
      contentType: req.body.contentType,
    })

    sendResponse({
      res,
      message: 'done',
      data: result,
    })
  })

  static userLikedVideo = Catch.async(async (req, res) => {
    const user = GetDefined.loggedInUser(req.user)
    denyGuestUser(user)

    const likeDocument = await LikeModel.findOne({
      user: user._id,
      content: req.params.id,
      contentType: 'vod',
    })

    sendResponse({
      res,
      message: '',
      data: {
        user_liked: !!likeDocument,
      },
    })
  })

  static unLikeVideo = Catch.async(async (req, res) => {
    const user = GetDefined.loggedInUser(req.user)
    denyGuestUser(user)

    const deletedLikeDocument = await LikeModel.findOneAndDelete({
      user: user._id,
      content: req.params.id,
    })

    if (deletedLikeDocument == null) {
      throw new OperationalError('Like Not Found', 404)
    }

    if (deletedLikeDocument.contentType !== 'vod') {
      return
    }

    await VideoRepo.computeEngagements({
      session: undefined,
      property: 'likesCount',
      by: -1,
      id: deletedLikeDocument.content,
    })

    sendResponse({
      res,
      message: 'video unliked',
    })
  })

  // ************ GET EVENTS *********************//

  static getLiveEventsByType = (type: LiveEventsType) =>
    Catch.async(async (req, res) => {
      let filter: FilterQuery<LiveSchema> = { expired: false }

      switch (type) {
        case 'featured':
          filter.featured = true
          break
        case 'sponsored':
          filter.sponsored = true
          break
        case 'channels':
          filter.type = 'channel'
          break
        case 'channels popular':
          filter.type = 'channel'
          filter.popular = true
          break
        case 'events':
          filter.type = 'event'
          break
        case 'events popular':
          filter.type = 'event'
          filter.popular = true
          break
        case 'tvshows':
          filter.type = 'tvshow'
          break
        case 'tvshows popular':
          filter.type = 'tvshow'
          filter.popular = true
          break
        case 'sports popular':
          filter.type = 'sport'
          filter.popular = true
          break
        case 'sports':
          filter.type = 'sport'
          break
        case 'podcasts':
          filter.type = 'podcast'
          break
        case 'podcasts popular':
          filter.type = 'podcast'
          filter.popular = true
          break

        default:
          filter = filter
          break
      }

      const currentUser = GetDefined.loggedInUser(req.user)
      if (isGuestUser(currentUser)) filter.vid_class = 'free'

      const vidQuality = isGuestUser(currentUser)
        ? '480p'
        : await VidUploadUtils.getUserVideoQuality(currentUser._id.toString())

      const { page, limit } = QueryParamsFeatures.paginagteParams(req.query)

      const liveEvents = await LiveMediaSourcesUtils.resolveSources(
        await LiveRepo.getSelectedLive(filter, page, limit),
        vidQuality,
      )

      sendResponse({
        res,
        data: liveEvents,
        message: 'Events fetched',
      })
    })

  static bannerContents = Catch.async(async (req, res) => {
    const page = guranteeNumericResult(req.query.page, 1)
    const limit = guranteeNumericResult(req.query.limit, 10)

    const currentUser = GetDefined.loggedInUser(req.user)
    const vidQuality = isGuestUser(currentUser)
      ? '480p'
      : await VidUploadUtils.getUserVideoQuality(currentUser._id.toString())

    let lives: LiveAggrRes[] = await LiveMediaSourcesUtils.resolveSources(
      filterGuestLives(await LiveRepo.getFeatured(page, limit), currentUser),
      vidQuality,
    )

    let vods: VodCardResponse[] = MovieMediaSourcesUtils.resolveMediaSources(
      filterGuestVods(await VideoRepo.fetchFeatured(page, limit), currentUser),
      vidQuality,
    )

    //

    // if (lives.length + vods.length < 10) {
    //   lives = await LiveMediaSourcesUtils.resolveSources(
    //     await LiveRepo.getMostEngaged(page, limit),
    //     vidQuality,
    //   )

    //   vods = MovieMediaSourcesUtils.resolveMediaSources(
    //     await VideoRepo.fetchMostEngaged(page, limit),
    //     vidQuality,
    //   )
    // }

    // TODO: This is hackey. Optimize and Polish
    lives = isGuestUser(currentUser)
      ? lives.map(live => Object.assign(live, { canView: true }))
      : getPromiseAllFulfilledResults(
          await Promise.allSettled(
            lives.map(async live => {
              const response = Object.assign(live, {
                canView: (
                  await PaymentService.checkHasValidContentPayment({
                    currentUserId: currentUser._id,
                    contentId: live._id,
                    contentType: 'live',
                  })
                ).canView,
              })

              return response
            }),
          ),
        )

    sendResponse({
      res,
      message: 'contents fetched',
      data: {
        lives,
        vods,
      },
    })
  })

  static streamLiveEvent = Catch.async(async (req, res) => {
    const streamId = req.params.id
    const currentUser = GetDefined.loggedInUser(req.user)
    const event = await LiveModel.findById(streamId)

    if (event == null) {
      throw new OperationalError('invalid stream ID', 404)
    }

    if (event.expired || event.expiry <= new Date()) {
      throw new OperationalError('stream event has expired', 400)
    }
    assertGuestCanView(currentUser, event.vid_class)

    if (event.vid_class !== 'free') {
      const access = await PaymentService.checkHasValidContentPayment({
        currentUserId: currentUser._id,
        contentId: event._id.toString(),
        contentType: 'live',
      })
      if (!access.canView) {
        throw new OperationalError('Successful wallet payment required to watch this content', 403)
      }
    }

    const stream_url = `${env.RP_PLAYBACK_URL}${event.stream_key}/index.m3u8`

    const data = {
      live_data: event,
      url: stream_url,
    }

    sendResponse({
      res,
      data,
      message: 'live event fetched',
    })
  })
}
