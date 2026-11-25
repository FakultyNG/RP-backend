import { AdModel, AdSchema } from '../../models/admanager.model'
import { AdManagerRepo, FetchAdResult } from '../../repositories/AddManagerRepo'
import { ExpressRequestQuery, QueryParamsFeatures } from '../../utils/QueryParamsFeatures'
import { OperationalError } from '../../utils/OperationalError'
import { MulterFile } from '../../types'
import { MediaManagement } from '../media-management'
import { MaybeSession, withMongoDBSession } from '../../utils/mongoDbSessionRunner'
import { Purge } from '../../utils/Purge'
import { VideoQuality, VidUploadUtils } from '../../utils/VideoUploadUtils'
import { MediaAccess } from '../media-access'
import { UploadMediaUtils } from '../../utils/UploadMediaUtils'
import { CategoryEnumService } from './CategoryEnumsService'
import { CampaignReportService } from './CampaignReportService'

export interface CreateAdData extends Omit<
  AdSchema,
  'createdAt' | 'updatedAt' | 'video' | 'photo'
> {
  videoFile: MulterFile
  imageFile: MulterFile
}

export interface CreateHomeAdData {
  title: string
  link: string
  start: string
  expiry: string
  active: boolean
  imageFile: MulterFile
}

export interface UpdateAdData {
  title: string
  type: 'mobile'
  brand: string
  link: string
  cta: string
  duration?: number
  start: string
  expiry: string
  active: boolean
  advertiserEmails: string[]
  reportDelivery: 'none' | 'live_link' | 'csv'
  reportFrequency: 'daily' | 'weekly' | 'monthly'
  reportTimezone: string
  videoFile?: MulterFile
  imageFile?: MulterFile
}

interface UploadMediaInput {
  videoFile: MulterFile
  imageFile: MulterFile
  expire: Date
}

export class AdManagerService {
  protected static _resolveMediaSources = (
    ads: FetchAdResult[],
    quality?: VideoQuality,
    includeReporting = false,
  ) => {
    return ads.map(ad => {
      const photoUrl = MediaAccess.getImageAndSubtitleURL(ad.photo.Key)
      const hasVideo = Boolean(ad.videoUpload)
      const videoUrl = ad.videoUpload?.isTranscoded
        ? VidUploadUtils.getResSourceUrl(ad.videoUpload, quality ?? '720p')
        : undefined

      const resolved = Object.assign(ad, {
        photoUrl,
        videoUrl,
        hasVideo,
        videoUpload: undefined,
        photo: undefined,
        __v: undefined,
        isVideoReady: undefined,
      })
      if (includeReporting) {
        return Object.assign(resolved, {
          reportLink:
            ad.reportDelivery === 'live_link'
              ? CampaignReportService.reportLink(ad._id.toString(), ad.reportTokenVersion)
              : undefined,
        })
      }
      return Object.assign(resolved, {
        advertiserEmails: undefined,
        reportDelivery: undefined,
        reportFrequency: undefined,
        reportTimezone: undefined,
        reportTokenVersion: undefined,
        nextReportAt: undefined,
        lastReportAt: undefined,
      })
    })
  }

  protected static _uploadMedia = async ({ videoFile, imageFile, expire }: UploadMediaInput) => {
    const [imageUploadResult, videoUploadResult] = await Promise.allSettled([
      MediaManagement.storeImageAndSubtitle(imageFile, expire, 'landscape-poster'),
      MediaManagement.upload720pAndInitiateMediaConvert(videoFile, expire),
    ])

    if (imageUploadResult.status === 'rejected') {
      throw imageUploadResult.reason
    }

    if (videoUploadResult.status === 'rejected') {
      throw videoUploadResult.reason
    }

    return {
      imageUpload: imageUploadResult.value,
      videoUpload: videoUploadResult.value,
    }
  }

  static create = async (data: CreateAdData) =>
    await withMongoDBSession(this._createTransaction, data)

  static createHomeAd = async ({
    title,
    link,
    start,
    expiry,
    active,
    imageFile,
  }: CreateHomeAdData) => {
    await CategoryEnumService.ensurePremiumAdsCategory()

    const { startAt, expireAt } = this._schedule(start, expiry)

    const imageUpload = await MediaManagement.storeImageAndSubtitle(
      imageFile,
      expireAt,
      'landscape-poster',
    )

    return await AdModel.create({
      title,
      type: 'home_ad',
      brand: 'Home-Ads',
      link,
      cta: 'Learn More',
      duration: 0,
      start: startAt,
      expiry: expireAt,
      active,
      photo: {
        Bucket: imageUpload.Bucket,
        Key: imageUpload.Key,
      },
    })
  }

  protected static _schedule = (start: string | Date, expiry: string | Date) => {
    const startAt = new Date(start)
    const expireAt = new Date(expiry)
    if (
      Number.isNaN(startAt.getTime()) ||
      Number.isNaN(expireAt.getTime()) ||
      expireAt <= startAt ||
      expireAt <= new Date()
    ) {
      throw new OperationalError('Expiry must be later than the start time and in the future', 400)
    }
    return { startAt, expireAt }
  }

  static getHomeAds = async () => {
    await this.deleteExpiredAds()
    const ads = await AdManagerRepo.fetchHomeAds()
    return ads.map(ad => ({
      _id: ad._id,
      title: ad.title,
      type: ad.type,
      link: ad.link,
      active: ad.active,
      photoUrl: MediaAccess.getImageAndSubtitleURL(ad.photo.Key),
      createdAt: ad.createdAt,
      updatedAt: ad.updatedAt,
    }))
  }

  static _createTransaction = async (
    {
      active,
      expiry,
      start,
      duration,
      link,
      videoFile,
      imageFile,
      brand,
      type,
      title,
      cta,
      advertiserEmails,
      reportDelivery,
      reportFrequency,
      reportTimezone,
    }: CreateAdData,
    session: MaybeSession,
  ) => {
    const { startAt, expireAt } = this._schedule(start, expiry)
    await CategoryEnumService.ensurePremiumAdsCategory()

    const { imageUpload, videoUpload } = await this._uploadMedia({
      videoFile,
      imageFile,
      expire: expireAt,
    })

    const adDocument = new AdModel({
      title,
      type,
      brand,
      link,
      duration,
      cta,
      active,
      advertiserEmails: [
        ...new Set((advertiserEmails ?? []).map(email => email.trim().toLowerCase())),
      ],
      reportDelivery: reportDelivery ?? 'none',
      reportFrequency: reportFrequency ?? 'weekly',
      reportTimezone: reportTimezone ?? 'Africa/Lagos',
      nextReportAt: CampaignReportService.nextReportAt(
        startAt,
        reportDelivery !== undefined && reportDelivery !== 'none' && advertiserEmails?.length > 0,
      ),
      expiry: expireAt,
      start: startAt,
      photo: {
        Bucket: imageUpload.Bucket,
        Key: imageUpload.Key,
      },
    })

    const videoUploadDocument = UploadMediaUtils.getVideoUploadDocument(videoUpload)
    videoUploadDocument.parentId = adDocument._id
    videoUploadDocument.parentType = 'ad'
    adDocument.videoUpload = videoUploadDocument._id
    await adDocument.save({ session })
    await videoUploadDocument.save({ session })
    return adDocument
  }

  static update = async (adId: string, data: UpdateAdData) => {
    const ad = await AdModel.findById(adId)
    if (ad === null) {
      throw new OperationalError('Ad not found', 404)
    }

    const { startAt, expireAt } = this._schedule(data.start, data.expiry)
    const advertiserEmails = [
      ...new Set((data.advertiserEmails ?? []).map(email => email.trim().toLowerCase())),
    ]
    const reportDelivery = data.reportDelivery ?? 'none'
    const reportFrequency = data.reportFrequency ?? 'weekly'
    const reportTimezone = data.reportTimezone ?? 'Africa/Lagos'
    const previousPhoto = ad.photo
    const previousVideoUpload = ad.videoUpload
    let replacementPhoto = ad.photo
    let replacementVideoUpload = ad.videoUpload

    if (!data.videoFile && !replacementVideoUpload) {
      throw new OperationalError('A video file is required for this ad placement', 400)
    }

    if (data.imageFile) {
      const uploadedPhoto = await MediaManagement.storeImageAndSubtitle(
        data.imageFile,
        expireAt,
        'landscape-poster',
      )
      replacementPhoto = { Bucket: uploadedPhoto.Bucket, Key: uploadedPhoto.Key }
    }

    if (data.videoFile) {
      const uploadedVideo = await MediaManagement.upload720pAndInitiateMediaConvert(
        data.videoFile,
        expireAt,
      )
      const videoUploadDocument = UploadMediaUtils.getVideoUploadDocument(uploadedVideo)
      videoUploadDocument.parentId = ad._id
      videoUploadDocument.parentType = 'ad'
      await videoUploadDocument.save()
      replacementVideoUpload = videoUploadDocument._id
    }

    ad.set({
      title: data.title.trim(),
      type: data.type,
      brand: data.brand.trim(),
      link: data.link.trim(),
      cta: data.cta.trim(),
      duration: data.duration ?? 0,
      start: startAt,
      expiry: expireAt,
      active: data.active,
      photo: replacementPhoto,
      videoUpload: replacementVideoUpload,
      isVideoReady: data.videoFile ? false : ad.isVideoReady,
      advertiserEmails,
      reportDelivery,
      reportFrequency,
      reportTimezone,
      nextReportAt: CampaignReportService.nextReportAt(
        startAt,
        reportDelivery !== 'none' && advertiserEmails.length > 0,
      ),
      archivedAt: undefined,
    })
    await ad.save()

    const cleanup: Promise<unknown>[] = []
    if (data.imageFile) {
      cleanup.push(MediaManagement.deleteObject(previousPhoto.Key, previousPhoto.Bucket))
    }
    if (
      previousVideoUpload &&
      previousVideoUpload.toString() !== replacementVideoUpload?.toString()
    ) {
      cleanup.push(Purge.videoUploadById(previousVideoUpload))
    }
    await Promise.allSettled(cleanup)
    return ad
  }

  static getMany = async (videoQuality: VideoQuality, query: ExpressRequestQuery) => {
    await this.deleteExpiredAds()
    const { skip, limit } = QueryParamsFeatures.paginagteParams(query)

    const ads = await AdManagerRepo.fetchMany({
      skip,
      limit,
      type: query.type,
    })

    return this._resolveMediaSources(ads, videoQuality, true)
  }

  static getRandom = async (videoQuality: VideoQuality, type: unknown) => {
    const ads = await AdManagerRepo.fetcRandom(type)
    return this._resolveMediaSources(ads, videoQuality)
  }

  protected static _deleteMedia = async (ad: AdSchema) => {
    const cleanup: Promise<unknown>[] = [
      MediaManagement.deleteObject(ad.photo.Key, ad.photo.Bucket),
    ]
    if (ad.videoUpload) cleanup.push(Purge.videoUploadById(ad.videoUpload))
    await Promise.allSettled(cleanup)
  }

  static deleteExpiredAds = async () => {
    const now = new Date()
    const archived = await AdModel.updateMany(
      { expiry: { $lte: now }, archivedAt: { $exists: false } },
      { $set: { archivedAt: now, active: false }, $unset: { nextReportAt: 1 } },
    )
    return archived.modifiedCount
  }

  static deleteAd = async (addId: string) => {
    const deletedAdDocument = await AdModel.findByIdAndDelete(addId)

    if (deletedAdDocument == null) {
      throw new OperationalError('Ad not found', 404)
    }

    await this._deleteMedia(deletedAdDocument)
  }
}
