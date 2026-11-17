import { FilterQuery, UpdateQuery } from 'mongoose'
import { SettingsModel, SettingsSchema } from '../../models/userSettings.model'
import { LoggedInUser } from '../../types'
import { OperationalError } from '../../utils/OperationalError'
import { MaybeSession, withMongoDBSession } from '../../utils/mongoDbSessionRunner'
import { denyGuestUser } from '../../utils/denyGuestUser'
import { UserModel } from '../../models/users.model'
import { VideoQuality } from '../../utils/VideoUploadUtils'
import { Types } from 'mongoose'
import { GenreEnumModel } from '../../models/genreEnum.model'
import { CategoryEnumModel } from '../../models/categoryEnum.model'

type PushPull = 'pull' | 'push'

type InterestPreferences = {
  genreIds?: string[]
  categoryIds?: string[]
}

export type NotificationPreferences = {
  allow_notifications?: boolean
  new_services?: boolean
  upcoming_events?: boolean
  new_arrivals?: boolean
  live_channels?: boolean
}

const notificationPreferenceKeys: Array<keyof NotificationPreferences> = [
  'allow_notifications',
  'new_services',
  'upcoming_events',
  'new_arrivals',
  'live_channels',
]

export class CustomerSettingsService {
  static setNotificationPreferences = async (
    currentUser: LoggedInUser,
    preferences: NotificationPreferences,
  ) => {
    denyGuestUser(currentUser)
    const changes: NotificationPreferences = {}
    notificationPreferenceKeys.forEach(key => {
      if (typeof preferences[key] === 'boolean') changes[key] = preferences[key]
    })
    if (Object.keys(changes).length === 0) {
      throw new OperationalError('At least one notification preference is required', 400)
    }

    const settings = await SettingsModel.findOneAndUpdate(
      { user_id: currentUser._id },
      { $set: changes },
      { upsert: true, new: true },
    ).select(notificationPreferenceKeys.join(' '))

    return {
      allow_notifications: settings.allow_notifications,
      new_services: settings.new_services,
      upcoming_events: settings.upcoming_events,
      new_arrivals: settings.new_arrivals,
      live_channels: settings.live_channels,
    }
  }

  static replaceInterests = async (
    currentUser: LoggedInUser,
    preferences: InterestPreferences,
  ) => {
    denyGuestUser(currentUser)

    const genreIds = [...new Set(preferences.genreIds ?? [])]
    const categoryIds = [...new Set(preferences.categoryIds ?? [])]
    if (genreIds.length + categoryIds.length > 7) {
      throw new OperationalError('Choose no more than 7 interests', 400)
    }

    const [genreCount, categoryCount] = await Promise.all([
      GenreEnumModel.countDocuments({ _id: { $in: genreIds.map(id => new Types.ObjectId(id)) } }),
      CategoryEnumModel.countDocuments({
        _id: { $in: categoryIds.map(id => new Types.ObjectId(id)) },
      }),
    ])
    if (genreCount !== genreIds.length || categoryCount !== categoryIds.length) {
      throw new OperationalError('One or more selected interests no longer exist', 400)
    }

    const settings = await SettingsModel.findOneAndUpdate(
      { user_id: currentUser._id },
      {
        $set: {
          interest: [],
          interest_genres: genreIds,
          interest_categories: categoryIds,
        },
      },
      { upsert: true, new: true },
    ).select('interest interest_genres interest_categories')

    return {
      genreIds: settings.interest_genres.map(id => id.toString()),
      categoryIds: settings.interest_categories.map(id => id.toString()),
    }
  }

  static setVideoQuality = async (
    currentUser: LoggedInUser,
    videoQuality: VideoQuality,
  ) => {
    denyGuestUser(currentUser)

    await withMongoDBSession(
      async (_, session) => {
        await Promise.all([
          SettingsModel.findOneAndUpdate(
            { user_id: currentUser._id },
            { $set: { video_quality: videoQuality } },
            { upsert: true, new: true, session },
          ),
          UserModel.findByIdAndUpdate(
            currentUser._id,
            { $set: { videoQuality } },
            { session },
          ),
        ])
      },
      undefined,
    )

    return { video_quality: videoQuality }
  }

  static pushInterest = async (currentUser: LoggedInUser, interest: string) => {
    if ((currentUser.role as string) === 'guest') {
      throw new OperationalError('you are not authenticated', 403)
    }

    await SettingsModel.findOneAndUpdate(
      {
        user_id: currentUser._id,
      },
      {
        $set: { interest },
      },
      {
        upsert: true,
      },
    )
  }

  static pushPullFromWatchlist = async (
    currentUser: LoggedInUser,
    videoId: string,
    type: PushPull,
  ) => {
    const change = { watchlist: videoId }

    const filter: FilterQuery<SettingsSchema> = {
      user_id: currentUser._id,
    }

    const changes: UpdateQuery<SettingsSchema> = {}

    if (type === 'pull') {
      changes.$pull = change
      filter.watchlist = videoId
    } else {
      changes.$push = change
    }

    await SettingsModel.findOneAndUpdate(filter, changes, {
      new: true,
    })
  }

  protected static _setSettingsSession = async (
    {
      currentUser,
      data,
    }: {
      currentUser: LoggedInUser
      data: Record<string, any>
    },
    session: MaybeSession,
  ) => {
    const {
      video_quality,
      allow_notifications,
      new_services,
      upcoming_events,
      new_arrivals,
      live_channels,
    } = data

    const settingsDocument = await SettingsModel.findOneAndUpdate(
      {
        user_id: currentUser.id,
      },
      {
        video_quality: video_quality,
        allow_notifications: allow_notifications,
        new_services: new_services,
        upcoming_events: upcoming_events,
        new_arrivals: new_arrivals,
        live_channels: live_channels,
      },
      {
        upsert: true,
        session,
      },
    )

    if (video_quality && settingsDocument != null) {
      await UserModel.findByIdAndUpdate(currentUser._id, { $set: { videoQuality: video_quality } })
    }
  }

  static setNotificationSettings = async (currentUser: LoggedInUser, data: Record<string, any>) => {
    denyGuestUser(currentUser)

    await withMongoDBSession(this._setSettingsSession, {
      currentUser,
      data,
    })
  }
}
