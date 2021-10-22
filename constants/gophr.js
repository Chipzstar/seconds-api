exports.JOB_STATUS = {
	NEW: "confirmed_by_customer".toUpperCase(),
	PENDING: "courier_proposed".toUpperCase(),
	ACCEPTED: "accepted_by_courier".toUpperCase(),
	AT_PICKUP: "at_pickup".toUpperCase(),
	EN_ROUTE: "en_route".toUpperCase(),
	AT_DELIVERY: "at_delivery".toUpperCase(),
	COMPLETED: "delivered".toUpperCase(),
	CANCELED: "canceled".toUpperCase()
}

exports.ERROR_CODES = {
	ERROR_MAX_DISTANCE_EXCEEDED: "ERROR_MAX_DISTANCE_EXCEEDED",
	ERROR_SAME_LAT_LNG: "ERROR_SAME_LAT_LNG",
	ERROR_DISTANCE: "ERROR_DISTANCE",
	ERROR_WORKING_HOURS: "ERROR_WORKING_HOURS",
	ERROR_DATETIME_INCORRECT: "ERROR_DATETIME_INCORRECT",
	ERROR_PHONE_NUMBER: "ERROR_PHONE_NUMBER",
	ERROR_PICKUP_ADDRESS_MISSING: "ERROR_PICKUP_ADDRESS_MISSING",
	ERROR_DELIVERY_ADDRESS_MISSING: "ERROR_DELIVERY_ADDRESS_MISSING"
}

exports.WEBHOOK_TYPES = {
	ETA: 'ETA_UPDATE',
	STATUS: 'STATUS_UPDATE'
}