import { useState } from 'react'

interface FloatingReviewsBadgeProps {
  businessName: string
  rating?: number
  reviewsCount?: number
}

interface ReviewItem {
  id: string
  author: string
  rating: number
  date: string
  comment: string
  verified: boolean
}

const DEMO_REVIEWS: ReviewItem[] = [
  {
    id: 'rev-1',
    author: 'Natnael Gizaw',
    rating: 5,
    date: '2 days ago',
    comment: 'Super sharp haircut, friendly service and no wait time. Booking through Werefa was seamless!',
    verified: true,
  },
  {
    id: 'rev-2',
    author: 'Selamawit T.',
    rating: 5,
    date: 'Last week',
    comment: 'Clean salon and Simon was punctual. Paid the Telebirr deposit easily.',
    verified: true,
  },
  {
    id: 'rev-3',
    author: 'Dawit Kassaye',
    rating: 4.8,
    date: '2 weeks ago',
    comment: 'Best grooming experience around Bole. Highly recommended.',
    verified: true,
  },
]

export function FloatingReviewsBadge({
  businessName,
  rating = 4.9,
  reviewsCount = 48,
}: FloatingReviewsBadgeProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="floating-reviews-badge"
        onClick={() => setIsOpen(true)}
        aria-label={`View verified reviews: ${rating} out of 5 based on ${reviewsCount} reviews`}
      >
        <span className="floating-reviews-badge__star" aria-hidden="true">★</span>
        <span className="floating-reviews-badge__score">{rating.toFixed(1)}</span>
        <span className="floating-reviews-badge__count">({reviewsCount} Reviews)</span>
      </button>

      {isOpen && (
        <div className="reviews-modal-backdrop" onClick={() => setIsOpen(false)}>
          <div
            className="reviews-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reviews-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="reviews-modal__header">
              <div>
                <h3 id="reviews-modal-title" className="reviews-modal__title">
                  {businessName}
                </h3>
                <div className="reviews-modal__rating-row">
                  <span className="reviews-modal__stars">★★★★★</span>
                  <span className="reviews-modal__avg">{rating.toFixed(1)}</span>
                  <span className="reviews-modal__total">· {reviewsCount} verified bookings</span>
                </div>
              </div>
              <button
                type="button"
                className="reviews-modal__close"
                onClick={() => setIsOpen(false)}
                aria-label="Close reviews modal"
              >
                ✕
              </button>
            </div>

            <div className="reviews-modal__trust-badge">
              <span className="trust-badge__icon">✓</span>
              <span>Verified Ethiopian Service Business on Werefa</span>
            </div>

            <div className="reviews-modal__list">
              {DEMO_REVIEWS.map((review) => (
                <div key={review.id} className="review-card">
                  <div className="review-card__header">
                    <span className="review-card__author">{review.author}</span>
                    <span className="review-card__date">{review.date}</span>
                  </div>
                  <div className="review-card__stars">{'★'.repeat(Math.round(review.rating))}</div>
                  <p className="review-card__comment">{review.comment}</p>
                </div>
              ))}
            </div>

            <div className="reviews-modal__footer">
              <button
                type="button"
                className="btn btn--block btn--outline"
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
