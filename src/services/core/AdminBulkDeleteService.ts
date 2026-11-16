import { AdManagerService } from './AdmanagerService'
import { AdminPlanSubService } from './AdminPlanService'
import { AdminUploadService } from './AdminUploadService'
import { AdminUsersService } from './AdminUsersService'
import { CastEnumService } from './CastEnumService'
import { CategoryEnumService } from './CategoryEnumsService'
import { GenreService } from './GenreService'
import { GiftCardService } from './GiftCardService'
import { LiveStreamService } from './LiveStreamService'
import { SuggestionService } from './SuggestionService'
import { LiveModel } from '../../models/lives.model'
import { UserModel } from '../../models/users.model'
import { VideoModel } from '../../models/videos.model'
import { LoggedInUser } from '../../types'
import { OperationalError } from '../../utils/OperationalError'
import { AutoFeaturedService } from './AutoFeaturedService'

export const bulkDeleteResources = [
  'ads',
  'users',
  'clients',
  'categories',
  'genres',
  'casts',
  'giftcards',
  'plans',
  'lives',
  'uploads',
  'upcoming',
  'featured',
  'suggestions',
] as const

export type BulkDeleteResource = (typeof bulkDeleteResources)[number]

type BulkDeleteInput = {
  resource: unknown
  ids: unknown
  currentUser: LoggedInUser
}

const getErrorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : 'Delete failed'

export class AdminBulkDeleteService {
  private static validateInput(resource: unknown, ids: unknown) {
    if (
      typeof resource !== 'string' ||
      !bulkDeleteResources.includes(resource as BulkDeleteResource)
    ) {
      throw new OperationalError('Invalid bulk-delete resource', 400)
    }

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
      throw new OperationalError('ids must contain between 1 and 100 records', 400)
    }

    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.some(id => typeof id !== 'string' || id.trim() === '')) {
      throw new OperationalError('Every id must be a non-empty string', 400)
    }

    return {
      resource: resource as BulkDeleteResource,
      ids: uniqueIds as string[],
    }
  }

  private static async removeFeatured(id: string) {
    const autoFeaturedBlockedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const video = await VideoModel.findByIdAndUpdate(id, {
      $set: { featured: false, autoFeaturedBlockedUntil },
      $unset: { feat_expiry: 1, featuredSource: 1, featuredAt: 1, featuredScore: 1 },
    })
    if (video) return

    const live = await LiveModel.findByIdAndUpdate(id, {
      $set: { featured: false, autoFeaturedBlockedUntil },
      $unset: { feat_expiry: 1, featuredSource: 1, featuredAt: 1, featuredScore: 1 },
    })
    if (!live) throw new OperationalError('Featured content not found', 404)
  }

  private static async removeUpcoming(id: string, currentUser: LoggedInUser) {
    const video = await VideoModel.findByIdAndUpdate(id, {
      $set: { upcoming: false },
    })
    if (video) return

    await LiveStreamService.deleteLive({ liveId: id, currentUser })
  }

  private static async removeUpload(id: string) {
    const video = await VideoModel.findById(id).select('type')
    if (!video) throw new OperationalError('Uploaded content not found', 404)
    await AdminUploadService.deleteVideo(id, video.type)
  }

  private static async removeUser(id: string, resource: 'users' | 'clients') {
    const permittedRoles =
      resource === 'users' ? ['customer'] : ['channel', 'tvshow', 'podcast', 'event']
    const user = await UserModel.findOne({ _id: id, role: { $in: permittedRoles } }).select('_id')

    if (!user) {
      throw new OperationalError(`${resource === 'users' ? 'User' : 'Client'} not found`, 404)
    }

    return AdminUsersService.deleteOne(id)
  }

  private static async removeOne(
    resource: BulkDeleteResource,
    id: string,
    currentUser: LoggedInUser,
  ) {
    switch (resource) {
      case 'ads':
        return AdManagerService.deleteAd(id)
      case 'users':
      case 'clients':
        return this.removeUser(id, resource)
      case 'categories':
        return CategoryEnumService.deleteCategoryById(id)
      case 'genres':
        return GenreService.deleteGenreByNameOrId('_id', id)
      case 'casts':
        return CastEnumService.deleteById(id)
      case 'giftcards':
        return GiftCardService.deleteById(id)
      case 'plans':
        return AdminPlanSubService.deletePlan(id)
      case 'lives':
        return LiveStreamService.deleteLive({ liveId: id, currentUser })
      case 'uploads':
        return this.removeUpload(id)
      case 'upcoming':
        return this.removeUpcoming(id, currentUser)
      case 'featured':
        return this.removeFeatured(id)
      case 'suggestions':
        return SuggestionService.adminDeleteSuggestionById(id)
    }
  }

  static deleteMany = async (input: BulkDeleteInput) => {
    const { resource, ids } = this.validateInput(input.resource, input.ids)
    const results = await Promise.allSettled(
      ids.map(id => this.removeOne(resource, id, input.currentUser)),
    )

    const failed = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [{ id: ids[index], message: getErrorMessage(result.reason) }]
        : [],
    )

    if (resource === 'featured' && failed.length < ids.length) {
      await AutoFeaturedService.refreshIfDue(true)
    }

    return {
      requested: ids.length,
      deleted: ids.length - failed.length,
      failed,
    }
  }
}
