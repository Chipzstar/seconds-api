exports.AUTHORIZATION_KEY = "X-Seconds-Api-Key".toLowerCase();
exports.PROVIDER_ID = "X-Seconds-Provider-Id".toLowerCase();

exports.DELIVERY_TYPES = {
	ON_DEMAND: "on-demand",
	SAME_DAY: "scheduled"
}

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
	GOPHR: "gophr",
	STREET_STREAM: "street_stream"
}

exports.VEHICLE_CODES = {
	BIC: {
		name: "Bicycle",
		x: 40,
		y: 20,
		z: 15,
		weight: 8,
		stuartPackageType: 'xsmall',
		gophrVehicleType: 10,
		streetPackageType: 'PT1006'
	},
	MTB: {
		name: "Motorbike",
		x: 40,
		y: 30,
		z: 30,
		weight: 12,
		stuartPackageType: 'small',
		gophrVehicleType: 20,
		streetPackageType: 'PT1008'
	},
	CAR: {
		name: "Car",
		x: 60,
		y: 40,
		z: 40,
		weight: 25,
		stuartPackageType: 'large',
		gophrVehicleType: 30,
		streetPackageType: 'PT1009'
	},
	CGB: {
		name: "CargoBike",
		x: 60,
		y: 50,
		z: 50,
		weight: 65,
		stuartPackageType: 'medium',
		gophrVehicleType: 15,
		streetPackageType: 'PT1012'
	},
	VAN: {
		name: "Van",
		x: 150,
		y: 120,
		z: 90,
		weight: 70,
		gophrVehicleType: 40,
		stuartPackageType: 'xlarge',
		streetPackageType: 'PT1010'
	}
}

const numbers = '1234567890'
const lowerCase = 'abcdefghijklmnopqrstuvwxyz'
const upperCase = lowerCase.toUpperCase()
const symbols = '~!@$^&*()-+{}][|,./;:\''

exports.alphabet = String(numbers + numbers + lowerCase + upperCase + symbols)