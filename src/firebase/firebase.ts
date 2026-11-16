import admin from 'firebase-admin'
import env from '../env'

const serviceAccount = JSON.parse(
  Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'),
)

if (admin.apps.length === 0) {
  const credential = admin.credential.cert(serviceAccount)
  admin.initializeApp({ credential })
}

export default admin
