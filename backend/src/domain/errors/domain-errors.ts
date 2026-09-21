import { AppError, ErrorFields } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * Domain error factories (Prompt 41 §19).
 *
 * Every domain/application condition maps to an EXISTING taxonomy code
 * (architecture doc 23; spec §33) through the Prompt 39 envelope. No ad hoc
 * codes, no Prisma/database internals, and no other-tenant data are leaked.
 */
export const domainErrors = {
  businessNotFound(detail = 'Business not found.'): AppError {
    return AppError.notFound(detail);
  },

  unauthorizedTenantAccess(detail = 'You are not allowed to access this business.'): AppError {
    return AppError.forbidden(detail);
  },

  inactiveService(fields: ErrorFields): AppError {
    return new AppError({
      code: ErrorCode.VALIDATION_ERROR,
      title: 'Invalid request',
      detail: 'One or more selected services are no longer active.',
      status: 400,
      fields,
    });
  },

  invalidSchedule(fields: ErrorFields, detail?: string): AppError {
    return new AppError({
      code: ErrorCode.VALIDATION_ERROR,
      title: 'Invalid schedule',
      detail: detail ?? 'The schedule template contains invalid values.',
      status: 400,
      fields,
    });
  },

  unavailableAppointment(detail = 'The requested time is no longer available. Choose another time to continue.'): AppError {
    return new AppError({ code: ErrorCode.SLOT_UNAVAILABLE, title: 'Slot unavailable', detail });
  },

  invalidBookingState(detail = 'The booking is not in the required state for this action.'): AppError {
    return new AppError({
      code: ErrorCode.INVALID_TRANSITION,
      title: 'Invalid booking state',
      detail,
    });
  },

  invalidPaymentState(detail = 'The payment is not in the required state for this action.'): AppError {
    return new AppError({
      code: ErrorCode.INVALID_TRANSITION,
      title: 'Invalid payment state',
      detail,
    });
  },

  idempotencyConflict(detail = 'The submission key was already used for a different booking or customer.'): AppError {
    return new AppError({ code: ErrorCode.CONFLICT, title: 'Conflict', detail });
  },

  slugConflict(detail = 'This public slug is already in use.'): AppError {
    return new AppError({ code: ErrorCode.CONFLICT, title: 'Conflict', detail });
  },

  invalidResubmissionCode(detail = 'The verification code is invalid.'): AppError {
    return AppError.validation({ code: 'The provided verification code is invalid.' }, detail);
  },

  resubmissionCodeExpired(detail = 'The verification code has expired.'): AppError {
    return new AppError({ code: ErrorCode.TOKEN_EXPIRED, title: 'Token expired', detail });
  },

  resubmissionCodeUsed(detail = 'The verification code has already been used.'): AppError {
    return new AppError({ code: ErrorCode.TOKEN_USED, title: 'Token already used', detail });
  },

  rateLimited(detail = 'Too many attempts. Please try again later.'): AppError {
    return new AppError({ code: ErrorCode.RATE_LIMITED, title: 'Rate limited', detail });
  },

  subscriptionDisabled(detail = 'Bookings are disabled because the subscription is not active.'): AppError {
    return new AppError({
      code: ErrorCode.SUBSCRIPTION_EXPIRED,
      title: 'Subscription expired',
      detail,
    });
  },

  businessPaused(detail = 'Bookings are paused for this business.'): AppError {
    return new AppError({ code: ErrorCode.BUSINESS_PAUSED, title: 'Business paused', detail });
  },

  scheduleConflict(detail = 'The requested slot is now excluded by the schedule or blocked.'): AppError {
    return new AppError({ code: ErrorCode.SCHEDULE_AFFECTED, title: 'Schedule conflict', detail });
  },

  invalidLifecycleTransition(detail = 'This lifecycle transition is not permitted for the current state.'): AppError {
    return new AppError({
      code: ErrorCode.INVALID_TRANSITION,
      title: 'Invalid transition',
      detail,
    });
  },

  proofFileTooLarge(detail = 'The payment proof file is larger than the 5 MB limit.'): AppError {
    return new AppError({
      code: ErrorCode.FILE_TOO_LARGE,
      title: 'File too large',
      detail,
    });
  },

  proofFileTypeInvalid(detail = 'The payment proof must be an image or a PDF file.'): AppError {
    return new AppError({
      code: ErrorCode.FILE_TYPE_INVALID,
      title: 'Invalid file type',
      detail,
    });
  },

  proofRequired(detail = 'A payment proof is required when a deposit is due.'): AppError {
    return AppError.validation({ proof: 'A proof file is required.' }, detail);
  },
};