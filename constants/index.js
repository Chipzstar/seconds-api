exports.AUTHORIZATION_KEY = 'X-Seconds-Api-Key'.toLowerCase();
exports.PROVIDER_ID = 'X-Seconds-Provider-Id'.toLowerCase();

exports.DELIVERY_TYPES = {
	ON_DEMAND: {
		name: 'on-demand',
		ecofleet: 'on demand',
	},
	SAME_DAY: {
		name: 'same-day',
		ecofleet: 'same day',
	},
	NEXT_DAY: {
		name: 'next-day',
		ecofleet: null
	},
	MULTI_DROP: {
		name: 'multi-drop',
		ecofleet: null
	}
}

exports.STATUS = {
	NEW: 'new'.toUpperCase(),
	PENDING: 'pending'.toUpperCase(),
	DISPATCHING: 'dispatching'.toUpperCase(),
	EN_ROUTE: 'en-route'.toUpperCase(),
	COMPLETED: 'completed'.toUpperCase(),
	CANCELLED: 'cancelled'.toUpperCase(),
};

exports.SELECTION_STRATEGIES = {
	PRICE: 'price',
	ETA: 'eta',
	RATING: 'rating',
};

exports.PROVIDERS = {
	STUART: 'stuart',
	GOPHR: 'gophr',
	STREET_STREAM: 'street_stream',
	ECOFLEET: 'ecofleet',
	ADDISON_LEE: 'addison_lee'
};

exports.VEHICLE_CODES = ['BIC', 'MTB', 'CAR', 'CGB', 'VAN'];
exports.VEHICLE_CODES_MAP = {
	BIC: {
		name: 'Bicycle',
		x: 40, // in cm
		y: 20, // in cm
		z: 15, // in cm
		weight: 8, // in kg
		stuartPackageType: 'xsmall',
		gophrVehicleType: 10,
		streetPackageType: 'PT1006',
		streetVehicleType: 'BICYCLE',
		travelMode: 'bicycling',
		maxDistance: 5 // in miles
	},
	MTB: {
		name: 'Motorbike',
		x: 40, // in cm
		y: 30, // in cm
		z: 30, // in cm
		weight: 12, // in kg
		stuartPackageType: 'small',
		gophrVehicleType: 20,
		streetPackageType: 'PT1008',
		streetVehicleType: 'MOTORBIKE',
		travelMode: 'driving',
		maxDistance: 8 // in miles
	},
	CAR: {
		name: 'Car',
		x: 60, // in cm
		y: 40, // in cm
		z: 40, // in cm
		weight: 25,
		stuartPackageType: 'large',
		gophrVehicleType: 30,
		streetPackageType: 'PT1009',
		streetVehicleType: 'CAR_AND_PARCEL_MESSENGER',
		travelMode: 'driving',
		maxDistance: 12 // in miles
	},
	CGB: {
		name: 'CargoBike',
		x: 60, // in cm
		y: 50, // in cm
		z: 50, // in cm
		weight: 65, // in kg
		stuartPackageType: 'medium',
		gophrVehicleType: 15,
		streetPackageType: 'PT1012',
		streetVehicleType: 'CARGO_BIKE',
		travelMode: 'driving',
		maxDistance: 8 // in miles
	},
	VAN: {
		name: 'Van',
		x: 150, // in cm
		y: 120, // in cm
		z: 90, // in cm
		weight: 70, // in kg
		gophrVehicleType: 40,
		stuartPackageType: 'xlarge',
		streetPackageType: 'PT1010',
		streetVehicleType: 'MEDIUM_VAN_MESSENGER',
		travelMode: 'driving',
		maxDistance: 12 // in miles
	},
};

exports.COMMISSION = {
	GROWTH: {
		name: "growth",
		fee: 0.49,
		limit: 20
	},
	ENTERPRISE: {
		name: "enterprise",
		fee: 0.99,
		limit: 50
	}
}

exports.GOOGLE_MAPS_TRAVEL_MODES = {
	/** (default) indicates standard driving directions using the road network. */
	DRIVING: 'driving',
	/** requests walking directions via pedestrian paths & sidewalks (where available). */
	WALKING: 'walking',
	/** requests bicycling directions via bicycle paths & preferred streets (where available). */
	CYCLING: 'bicycling',
	/**
	 * requests directions via public transit routes (where available).
	 * If you set the mode to transit, you can optionally specify either a departure_time or an arrival_time.
	 * If neither time is specified, the departure_time defaults to now (that is, the departure time defaults to the current time).
	 * You can also optionally include a transit_mode and/or a transit_routing_preference.
	 */
	TRANSIT: 'transit',
};

const numbers = '1234567890';
const lowerCase = 'abcdefghijklmnopqrstuvwxyz';
const upperCase = lowerCase.toUpperCase();
const symbols = "~!@$^&*()-+{}][|,./;:'";

exports.alphabet = String(numbers + numbers + lowerCase + upperCase + symbols);