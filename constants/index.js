exports.AUTHORIZATION_KEY = "X-Seconds-Api-Key".toLowerCase();
exports.PROVIDER_ID = "X-Seconds-Provider-Id".toLowerCase();
exports.DOMAIN = "http://localhost:3000/subscription" || "https://seconds-app-client-dev.herokuapp.com/subscription";

exports.STATUS = {
	NEW: "new".toUpperCase(),
	PENDING: "pending".toUpperCase(),
	DISPATCHING: "dispatching".toUpperCase(),
	EN_ROUTE: "en-route".toUpperCase(),
	COMPLETED: "completed".toUpperCase(),
	CANCELLED: "cancelled".toUpperCase()
}

exports.SELECTION_STRATEGIES = {
	PRICE: "price",
	ETA: "eta",
	RATING: "rating"
}

exports.PROVIDERS = {
	STUART: "stuart",
	GOPHR: "gophr"
}

exports.ERROR_CODES = {
	UNPROCESSABLE_ENTITY: 422,
	INVALID_GRANT: 401
}

exports.AUTH_KEYS = {
	STUART: "d59328cec7b021d59f15208616d14c8d4653477c3db9d7eaa08629fa0bc3e395"
}

const numbers = '1234567890'
const lowerCase = 'abcdefghijklmnopqrstuvwxyz'
const upperCase = lowerCase.toUpperCase()
const symbols = '~!@$^&*()-+{}][|,./;:\''

exports.alphabet = String(numbers + numbers + lowerCase + upperCase + symbols)