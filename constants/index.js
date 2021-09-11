exports.AUTHORIZATION_KEY = "X-Seconds-Api-Key".toLowerCase();

exports.DELIVERY_STATUS = {
	CREATED: "created",
	PENDING: "pending",
	DISPATCHED: "dispatched",
	IN_PROGRESS: "in_progress",
	COMPLETED: "completed",
	CANCELLED: "cancelled",
	EXPIRED: "expired"
}

exports.SELECTION_STRATEGIES = {
	PRICE: "lowest-price",
	ETA: "fastest-delivery-time",
	RATING: "best-rating"
}

const numbers = '1234567890'
const lowerCase = 'abcdefghijklmnopqrstuvwxyz'
const upperCase = lowerCase.toUpperCase()
const symbols = '~!@$^&*()-+{}][|,./;:\''

exports.alphabet = String(numbers + numbers + lowerCase + upperCase + symbols)