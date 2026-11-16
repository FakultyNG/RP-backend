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

export interface CreateAdData
  extends Omit<AdSchema, 'createdAt' | 'updatedAt' | 'video' | 'photo'> {
  videoFile: MulterFile
  imageFile: MulterFile
}

export interface CreateHomeAdData {
  title: string
  link: string
  imageFile: MulterFile
}

interface UploadMediaInput {
  videoFile: MulterFile
  imageFile: MulterFile
  expire: Date
}

export class AdManagerService {
  protected static _resolveMediaSources = (ads: FetchAdResult[], quality?: VideoQuality) => {
    return ads.map(ad => {
      const photoUrl = MediaAccess.getImageAndSubtitleURL(ad.photo.Key)
      const videoUrl = ad.videoUpload
        ? VidUploadUtils.getResSourceUrl(ad.videoUpload, quality ?? '720p')
        : undefined

      return Object.assign(ad, {
        photoUrl,
        videoUrl,
        videoUpload: undefined,
        photo: undefined,
        __v: undefined,
        isVideoReady: undefined,
      })
    })
  }

  protected static _uploadMedia = async ({ videoFile, imageFile, expire }: UploadMediaInput) => {
    const [imageUploadResult, videoUploadResult] = await Promise.allSettled([
      MediaManagement.storeImageAndSubtitle(imageFile, expire, 'landscape-poster'),
      MediaManagement.uploadAndInitiateMediaConvert(videoFile, expire),
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

  static createHomeAd = async ({ title, link, imageFile }: CreateHomeAdData) => {
    await CategoryEnumService.ensurePremiumAdsCategory()

    const imageUpload = await MediaManagement.storeImageAndSubtitle(
      imageFile,
      undefined,
      'landscape-poster',
    )

    return await AdModel.create({
      title,
      type: 'home_ad',
      brand: 'Home-Ads',
      link,
      cta: 'Learn More',
      duration: 0,
      start: new Date(),
      expiry: new Date('2099-12-31T23:59:59.999Z'),
      active: true,
      photo: {
        Bucket: imageUpload.Bucket,
        Key: imageUpload.Key,
      },
    })
  }

  static getHomeAds = async () => {
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
    }: CreateAdData,
    session: MaybeSession,
  ) => {
    const expireAt = new Date(expiry)

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
      expiry: expireAt,
      start: new Date(start),
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

  static getMany = async (videoQuality: VideoQuality, query: ExpressRequestQuery) => {
    const { skip, limit } = QueryParamsFeatures.paginagteParams(query)

    const ads = await AdManagerRepo.fetchMany({
      skip,
      limit,
      type: query.type,
    })

    return this._resolveMediaSources(ads, videoQuality)
  }

  static getRandom = async (videoQuality: VideoQuality, type: unknown) => {
    const ads = await AdManagerRepo.fetcRandom(type)
    return this._resolveMediaSources(ads, videoQuality)
  }

  static deleteAd = async (addId: string) => {
    const deletedAdDocument = await AdModel.findByIdAndDelete(addId)

    if (deletedAdDocument == null) {
      throw new OperationalError('invalid add Id', 404)
    }

    MediaManagement.deleteObject(deletedAdDocument.photo.Key, deletedAdDocument.photo.Bucket)
    if (deletedAdDocument.videoUpload) {
      Purge.videoUploadById(deletedAdDocument.videoUpload)
    }
  }
}
