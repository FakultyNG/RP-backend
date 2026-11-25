import { Router } from 'express'
import { OnboardingController } from '../../controllers/customers/onboarding.customer'
import { PlatformSettingsController } from '../../controllers/common/platformSettings.controller'

export const router = Router()

router.get('/guest-access', PlatformSettingsController.getGuestAccess)
router.get('/live-access', PlatformSettingsController.getLiveAccess)
router.get('/validate-token', OnboardingController.authTokenValidity)
router.get('/validate-reftoken', OnboardingController.refTokenValidity)
router.get('/renew-accesstoken', OnboardingController.refreshAccessToken)
