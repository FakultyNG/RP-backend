import { createHmac } from 'node:crypto'
import { WebhooksService } from '../../services/core/WebhooksService'
import { Catch } from '../../utils/Catch'
import env from '../../env'
import { StorePurchaseService } from '../../services/core/StorePurchaseService'

export class WebhooksController {
  static appleStore = Catch.async(async (req, res) => {
    await StorePurchaseService.reconcileAppleNotification(req.body?.signedPayload)
    res.sendStatus(200)
  })

  static googlePlay = Catch.async(async (req, res) => {
    await StorePurchaseService.reconcileGoogleNotification(
      req.body?.message?.data,
      req.get('authorization'),
    )
    res.sendStatus(200)
  })
  static paystack = Catch.async(async (req, res) => {
    const hash = createHmac('sha512', env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex')

    const payshackHash = req.headers['x-paystack-signature']

    if (hash == payshackHash) {
      WebhooksService.paystackEvent(req.body)
    }

    res.sendStatus(200)
  })

  static flutterwaveV3 = Catch.async(async (req, res) => {
    if (req.headers['verif-hash'] !== env.FLUTTERWAVE_SECRET_HASH) {
      console.error('🛑Invalid flutterwave signature.', req.headers)
      res.sendStatus(403)
      return
    }

    WebhooksService.flutterEvent(req.body)
    res.sendStatus(200)
  })

  static wavePayment = Catch.async(async (req, res) => {
    console.log('Wave payment body', req.body, 'Authorization:', req.headers.Authorization)
    res.sendStatus(200)
  })
}
