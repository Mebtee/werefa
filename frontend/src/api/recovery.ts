import { apiRequest } from './http'
import type { RecoveryConfirmInput, RecoveryRequestInput } from './types'

/**
 * Super Admin emergency recovery client (Prompt 43 backend contract; spec
 * §20.3, REQ-198…200).
 *
 *  - `POST /auth/recovery/request` — always a generic 200, so the endpoint
 *    cannot be used to enumerate accounts; a code is only sent to the Super
 *    Admin's separate recovery email.
 *  - `POST /auth/recovery/confirm` — a valid one-time code immediately permits
 *    a new password, revokes every session and clears any lockout.
 *
 * The code is never returned to the client; it is delivered out of band.
 */
export const recoveryApi = {
  requestCode(input: RecoveryRequestInput) {
    return apiRequest<{ message: string }>('/auth/recovery/request', {
      method: 'POST',
      body: input,
      handleUnauthorized: false,
    }).then(({ data }) => data.message)
  },

  confirmReset(input: RecoveryConfirmInput) {
    return apiRequest<void>('/auth/recovery/confirm', {
      method: 'POST',
      body: input,
      handleUnauthorized: false,
    }).then(() => undefined)
  },
}
