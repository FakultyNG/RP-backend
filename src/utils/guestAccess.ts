import { LoggedInUser } from '../types'
import { OperationalError } from './OperationalError'

export const isGuestUser = (user: LoggedInUser | undefined) => user?.role === 'guest'

export const filterGuestVods = <T extends { vidClass?: string }>(
  items: T[],
  _user: LoggedInUser | undefined,
) => items

export const filterGuestLives = <T extends { vidClass?: string; vid_class?: string }>(
  items: T[],
  _user: LoggedInUser | undefined,
) => items

export const assertGuestCanView = (
  user: LoggedInUser | undefined,
  contentClass: string | undefined,
) => {
  if (isGuestUser(user) && contentClass !== 'free') {
    throw new OperationalError('Login required to access this content', 403)
  }
}
