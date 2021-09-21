exports.AUTHORIZATION_KEY = "X-Seconds-Api-Key".toLowerCase();

exports.DELIVERY_STATUS = {
	NEW: "new".toUpperCase(),
	PENDING: "pending".toUpperCase(),
	DISPATCHED: "dispatched".toUpperCase(),
	IN_PROGRESS: "in_progress".toUpperCase(),
	COMPLETED: "completed".toUpperCase(),
	CANCELLED: "cancelled".toUpperCase(),
	EXPIRED: "expired".toUpperCase()
}

exports.SELECTION_STRATEGIES = {
	PRICE: "price",
	ETA: "eta",
	RATING: "rating"
}

exports.ERROR_CODES = {
	UNPROCESSABLE_ENTITY: 422
}

const numbers = '1234567890'
const lowerCase = 'abcdefghijklmnopqrstuvwxyz'
const upperCase = lowerCase.toUpperCase()
const symbols = '~!@$^&*()-+{}][|,./;:\''

exports.alphabet = String(numbers + numbers + lowerCase + upperCase + symbols)