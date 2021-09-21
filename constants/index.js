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

exports.AUTH_KEYS = {
	STUART_1: "d59328cec7b021d59f15208616d14c8d4653477c3db9d7eaa08629fa0bc3e395",
	STUART_2: "0657f2829bd0fbc08d813ae6dbba45c485d9c503263c391cb3b9a8ec6811d223"
}

const numbers = '1234567890'
const lowerCase = 'abcdefghijklmnopqrstuvwxyz'
const upperCase = lowerCase.toUpperCase()
const symbols = '~!@$^&*()-+{}][|,./;:\''

exports.alphabet = String(numbers + numbers + lowerCase + upperCase + symbols)